import { asyncIter, PushAsyncIterator, ExtendedAsyncIterable, byteReader } from "ballvalve";
import * as fs from "fs";
import * as path from "path";
import { Bottle } from "./bottle";
import { BottleType } from "./bottle_cap";
import { EncryptReadOptions, readEncryptedBottle } from "./encrypted_bottle";
import { AsyncEvent, fileEvent, encryptedEvent } from "./events";
import { FileBottle, FileMetadata, statsToMetadata } from "./file_bottle";

const BUFFER_SIZE = Math.pow(2, 20);


export function archiveFile(
  filename: string,
  events?: PushAsyncIterator<AsyncEvent>,
  prefix: string = ""
): Bottle {
  const basename = path.basename(filename);
  let metadata = statsToMetadata(basename, fs.statSync(filename, { bigint: true }));

  if (metadata.folder) return archiveFolder(filename, events, prefix, metadata);
  const displayName = prefix ? path.join(prefix, basename) : basename;
  metadata.filename = displayName;
  const stream = asyncIter(fs.createReadStream(filename, { highWaterMark: BUFFER_SIZE }));

  if (events) events.push(fileEvent(metadata));
  return FileBottle.writeFile(metadata, stream);
}

// make a fake folder for holding several unrelated files
export function archiveFiles(
  filenames: string[],
  events?: PushAsyncIterator<AsyncEvent>,
  folderName: string = ""
): Bottle {
  const streams = async function* () {
    for (const f of filenames) {
      yield archiveFile(f, events, folderName + "/");
    }
  }();
  const metadata: FileMetadata = { folder: true, filename: folderName };
  if (events) events.push(fileEvent(metadata));
  return FileBottle.writeFolder(metadata, streams);
}

export function archiveFolder(
  folderName: string,
  events?: PushAsyncIterator<AsyncEvent>,
  prefix: string = "",
  metadata?: FileMetadata,
  files?: string[],
): Bottle {
  const basename = path.basename(folderName);
  if (!metadata) metadata = statsToMetadata(basename, fs.statSync(folderName, { bigint: true }));
  if (!files) files = fs.readdirSync(folderName);
  files.sort((a, b) => a.localeCompare(b));

  const displayName = (prefix ? path.join(prefix, basename) : basename) + "/";
  const streams = async function* () {
    for (const f of files) {
      yield archiveFile(path.join(folderName, f), events, displayName);
    }
  }();

  if (events) events.push(fileEvent(metadata));
  return FileBottle.writeFolder(metadata, streams);
}


type ArchiveReadOptions = EncryptReadOptions;

export async function* readArchive(
  stream: AsyncIterator<Buffer>,
  options: ArchiveReadOptions = {}
): AsyncIterable<AsyncEvent> {
  yield* readArchiveBottle(await Bottle.read(byteReader(stream)), options);
}

export async function* readArchiveBottle(bottle: Bottle, options: ArchiveReadOptions = {}): AsyncIterable<AsyncEvent> {
  switch (bottle.cap.type) {
    case BottleType.FILE: {
      const fileBottle = await FileBottle.read(bottle);
      if (fileBottle.meta.folder) {
        yield fileEvent(fileBottle.meta);
        for await (const b of asyncIter(fileBottle.readBottles())) yield* readArchiveBottle(b);
      } else {
        yield fileEvent(fileBottle.meta, await fileBottle.readFileContents());
      }
      break;
    }

    case BottleType.ENCRYPTED: {
      const d = await readEncryptedBottle(bottle, options);
      yield encryptedEvent(d.info);
      if (d.bottle) yield* readArchiveBottle(d.bottle);
      break;
    }

    default:
      console.log("FIXME");
      throw new Error("FIXME");
      break;
  }
}
