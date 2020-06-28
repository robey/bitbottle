import * as fs from "fs";
import * as posix from "posix";
import { asyncIter } from "ballvalve";
import * as bigInt from "big-integer";
import { Header } from "./header";
import { Bottle } from "./bottle";
import { BottleType, BottleCap } from "./bottle_cap"

enum Field {
  IntSize = 0,
  IntPosixMode = 1,
  IntCreatedNanos = 2,
  IntModifiedNanos = 3,
  IntAccessedNanos = 4,

  StringFilename = 0,
  StringMimeType = 1,
  StringPosixUser = 2,
  StringPosixGroup = 3,

  FlagFolder = 0,
}

export interface FileMetadata {
  folder: boolean;
  filename: string;
  mimeType?: string;
  size?: bigInt.BigInteger;

  posixMode?: number;
  createdNanos?: bigInt.BigInteger;
  modifiedNanos?: bigInt.BigInteger;
  accessedNanos?: bigInt.BigInteger;

  user?: string;
  group?: string;
}

export class FileBottle {
  constructor(public meta: FileMetadata, public files: AsyncIterator<AsyncIterator<Buffer> | Bottle>) {
    // pass
  }

  async readFileContents(): Promise<AsyncIterator<Buffer>> {
    if (this.meta.folder) throw new Error("readFileContents called on folder");
    const item = await this.files.next();
    if (item.done) throw new Error("Missing file contents");
    if (item.value instanceof Bottle) throw new Error("Found bottle instead of file contents");
    const stream = asyncIter(item.value).after(async () => {
      const next = await this.files.next();
      if (!next.done) throw new Error("Garbage after file contents");
    });
    return stream[Symbol.asyncIterator]();
  }

  async nextBottle(): Promise<Bottle | undefined> {
    if (!this.meta.folder) throw new Error("nextBottle called on file data");
    const item = await this.files.next();
    if (item.done) return undefined;
    if (!(item.value instanceof Bottle)) throw new Error("Found data instead of bottle");
    return item.value;
  }

  write(): Bottle {
    const cap = new BottleCap(BottleType.FILE, encodeFileHeader(this.meta));
    return new Bottle(cap, this.files);
  }

  static async read(bottle: Bottle): Promise<FileBottle> {
    if (bottle.cap.type != BottleType.FILE) throw new Error("Not a file bottle");
    return new FileBottle(decodeFileHeader(bottle.cap.header), bottle.streams);
  }
}


function encodeFileHeader(meta: FileMetadata): Header {
  const header = new Header();
  header.addString(Field.StringFilename, meta.filename);
  if (meta.folder) {
    header.addFlag(Field.FlagFolder);
  } else {
    header.addBigInt(Field.IntSize, meta.size ?? bigInt["0"]);
  }
  if (meta.mimeType !== undefined) header.addString(Field.StringMimeType, meta.mimeType);

  if (meta.posixMode !== undefined) header.addInt(Field.IntPosixMode, meta.posixMode);
  if (meta.createdNanos !== undefined) header.addBigInt(Field.IntCreatedNanos, meta.createdNanos);
  if (meta.modifiedNanos !== undefined) header.addBigInt(Field.IntModifiedNanos, meta.modifiedNanos);
  if (meta.accessedNanos !== undefined) header.addBigInt(Field.IntAccessedNanos, meta.accessedNanos);

  if (meta.user !== undefined) header.addString(Field.StringPosixUser, meta.user);
  if (meta.group !== undefined) header.addString(Field.StringPosixGroup, meta.group);

  return header;
}

// build a file bottle header out of an fs.Stats object.
// some hackery because typescript doesn't know that fs.Stats can have bigint fields now.
export function statsToMetadata(filename: string, stats: fs.Stats): FileMetadata {
  const meta: FileMetadata = {
    // for mysterious reasons, isDirectory() must be checked first, before it decays away.
    folder: stats.isDirectory(),
    filename,
    size: bigInt(stats.size as any as bigint),

    posixMode: stats.mode & 0x1ff,
    createdNanos: bigInt((stats as any).ctimeNs as bigint),
    modifiedNanos: bigInt((stats as any).mtimeNs as bigint),
    accessedNanos: bigInt((stats as any).atimeNs as bigint),
  };

  try {
    meta.user = posix.getpwnam(stats.uid).name;
  } catch (error) {
    // pass
  }

  try {
    meta.group = posix.getgrnam(stats.gid).name;
  } catch (error) {
    // pass
  }

  return meta;
}

function decodeFileHeader(header: Header): FileMetadata {
  const meta: FileMetadata = {
    folder: header.getFlag(Field.FlagFolder),
    filename: header.getString(Field.StringFilename) || "?",
  };

  const mimeType = header.getString(Field.StringMimeType);
  if (mimeType !== undefined) meta.mimeType = mimeType;
  const size = header.getBigInt(Field.IntSize);
  if (size !== undefined) meta.size = size;

  const posixMode = header.getInt(Field.IntPosixMode);
  if (posixMode !== undefined) meta.posixMode = posixMode;
  const createdNanos = header.getBigInt(Field.IntCreatedNanos);
  if (createdNanos !== undefined) meta.createdNanos = createdNanos;
  const modifiedNanos = header.getBigInt(Field.IntModifiedNanos);
  if (modifiedNanos !== undefined) meta.modifiedNanos = modifiedNanos;
  const accessedNanos = header.getBigInt(Field.IntAccessedNanos);
  if (accessedNanos !== undefined) meta.accessedNanos = accessedNanos;

  const user = header.getString(Field.StringPosixUser);
  if (user !== undefined) meta.user = user;
  const group = header.getString(Field.StringPosixGroup);
  if (group !== undefined) meta.group = group;

  return meta;
}
