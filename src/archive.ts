import { asyncIter, byteReader, PushAsyncIterator } from "ballvalve";
import * as fs from "fs";
import * as path from "path";
import { Bottle } from "./bottle";
import { BottleType } from "./bottle_cap";
import { readCompressedBottle, CompressionOptions, writeCompressedBottle } from "./compressed_bottle";
import { EncryptReadOptions, readEncryptedBottle, EncryptionOptions, writeEncryptedBottle } from "./encrypted_bottle";
import { AsyncEvent, compressedEvent, encryptedEvent, fileEvent, signedEvent, countStream } from "./events";
import { FileBottle, FileMetadata, statsToMetadata } from "./file_bottle";
import { readSignedBottle, VerifyOptions, SignOptions, writeSignedBottle } from "./signed_bottle";

const BUFFER_SIZE = Math.pow(2, 20);


export interface ArchiveWriteOptions extends CompressionOptions, SignOptions, EncryptionOptions {
  frameBlockSize?: number;
}

export interface Archive {
  stream: AsyncIterator<Buffer>;
  events: AsyncIterator<AsyncEvent>;
}

export async function writeArchive(
  filenames: string[],
  folderName: string = "archive",
  options: ArchiveWriteOptions = {},
): Promise<Archive> {
  const events = new PushAsyncIterator<AsyncEvent>();

  // innermost: the files themselves
  let bottle = archiveFiles(filenames, events, folderName);

  // next: compress?
  if (options.compression !== undefined) {
    const countedStream = countStream(bottle.write(options.frameBlockSize), events, "compress");
    bottle = await writeCompressedBottle(countedStream, options);
  }

  // next: encrypt?
  if (options.encryption !== undefined) {
    bottle = await writeEncryptedBottle(bottle.write(options.frameBlockSize), options);
  }

  // next: sign?
  if (options.hash !== undefined) {
    bottle = await writeSignedBottle(bottle.write(options.frameBlockSize), options);
  }

  const out = asyncIter(countStream(bottle.write(options.frameBlockSize), events, "archive")).after(async () => events.end());
  return { stream: out, events };
}

export function archiveFile(
  filename: string,
  events?: PushAsyncIterator<AsyncEvent>,
  displayPrefix?: string,
): Bottle {
  const basename = path.basename(filename);
  let metadata = statsToMetadata(basename, fs.statSync(filename, { bigint: true }));

  if (metadata.folder) return archiveFolder(filename, events, displayPrefix, metadata);
  const displayName = displayPrefix ? path.join(displayPrefix, basename) : basename;
  const stream = asyncIter(fs.createReadStream(filename, { highWaterMark: BUFFER_SIZE }));

  if (events) events.push(fileEvent(displayName, metadata));
  return FileBottle.writeFile(metadata, stream);
}

// make a fake folder for holding several unrelated files
export function archiveFiles(
  filenames: string[],
  events?: PushAsyncIterator<AsyncEvent>,
  folderName: string = "archive"
): Bottle {
  const streams = async function* () {
    for (const f of filenames) {
      yield archiveFile(f, events, folderName);
    }
  }();
  const metadata: FileMetadata = { folder: true, filename: folderName };
  if (events) events.push(fileEvent(folderName + "/", metadata));
  return FileBottle.writeFolder(metadata, streams);
}

export function archiveFolder(
  folderName: string,
  events?: PushAsyncIterator<AsyncEvent>,
  displayPrefix: string = "",
  metadata?: FileMetadata,
  files?: string[],
): Bottle {
  const basename = path.basename(folderName);
  if (!metadata) metadata = statsToMetadata(basename, fs.statSync(folderName, { bigint: true }));
  if (!files) files = fs.readdirSync(folderName);
  files.sort((a, b) => a.localeCompare(b));

  const displayName = (displayPrefix ? path.join(displayPrefix, basename) : basename) + "/";
  const streams = async function* () {
    for (const f of files) {
      yield archiveFile(path.join(folderName, f), events, displayName);
    }
  }();

  if (events) events.push(fileEvent(displayName, metadata));
  return FileBottle.writeFolder(metadata, streams);
}


export interface ArchiveReadOptions extends EncryptReadOptions, VerifyOptions {}

export async function* readArchive(
  stream: AsyncIterator<Buffer>,
  options: ArchiveReadOptions = {}
): AsyncIterable<AsyncEvent> {
  const events = new PushAsyncIterator<AsyncEvent>();
  const inStream = countStream(stream, events, "archive");
  const readEvents = readArchiveBottle(await Bottle.read(byteReader(inStream)), options);
  yield* asyncIter(events).merge(asyncIter(readEvents).after(async () => events.end()));
}

export async function* readArchiveBottle(
  bottle: Bottle,
  options: ArchiveReadOptions = {},
  displayPrefix?: string
): AsyncIterable<AsyncEvent> {
  switch (bottle.cap.type) {
    case BottleType.FILE: {
      const fileBottle = await FileBottle.read(bottle);
      const displayName = displayPrefix ? path.join(displayPrefix, fileBottle.meta.filename) : fileBottle.meta.filename;
      if (fileBottle.meta.folder) {
        yield fileEvent(displayName + "/", fileBottle.meta);
        for await (const b of asyncIter(fileBottle.readBottles())) yield* readArchiveBottle(b, options, displayName);
      } else {
        yield fileEvent(displayName, fileBottle.meta, await fileBottle.readFileContents());
      }
      break;
    }

    case BottleType.ENCRYPTED: {
      const d = await readEncryptedBottle(bottle, options);
      yield encryptedEvent(d.info);
      if (d.bottle) {
        yield* readArchiveBottle(d.bottle, options);
        await d.bottle.done();
      }
      break;
    }

    case BottleType.COMPRESSED: {
      const { method, bottle: inner } = await readCompressedBottle(bottle);
      yield compressedEvent(method);
      yield* readArchiveBottle(inner, options);
      await inner.done();
      break;
    }

    case BottleType.SIGNED: {
      const s = await readSignedBottle(bottle, options);
      yield* readArchiveBottle(s.bottle, options);
      await s.bottle.done();
      // post a signed event _after_ we can get & verify the signature
      yield signedEvent(s.method, await s.verified);
      break;
    }

    default:
      throw new Error(`Unknown bottle type ${bottle.cap.type}`);
  }
}
