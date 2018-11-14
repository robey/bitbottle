import * as fs from "fs";
import * as posix from "posix";
import { Decorate, Stream } from "ballvalve";
import { Header } from "./header";
import { Bottle, BottleType } from "./bottle";

enum Field {
  IntSize = 0,
  IntPosixMode = 1,
  IntCreatedNanos = 2,
  IntModifiedNanos = 3,
  IntAccessedNanos = 4,

  StringFilename = 0,
  StringMimeType = 1,
  StringPosixUsername = 2,
  StringPosixGroupname = 3,

  BoolIsFolder = 0,
}

export interface FileMetadata {
  folder: boolean;
  filename: string;
  mimeType?: string;
  size?: number;

  posixMode?: number;
  createdNanos?: number;
  modifiedNanos?: number;
  accessedNanos?: number;

  username?: string;
  groupname?: string;
}

export class FileBottle {
  private constructor(public meta: FileMetadata, public stream: Stream) {
    // pass
  }

  static write(meta: FileMetadata, stream: Stream): Stream {
    return Bottle.write(BottleType.File, encodeFileHeader(meta), Decorate.iterator([ stream ]));
  }

  static async read(bottle: Bottle): Promise<FileBottle> {
    return new FileBottle(decodeFileHeader(bottle.cap.header), bottle.onlyOneStream());
  }
}


function encodeFileHeader(meta: FileMetadata): Header {
  const header = new Header();
  header.addString(Field.StringFilename, meta.filename);
  if (meta.folder) {
    header.addBoolean(Field.BoolIsFolder);
  } else {
    header.addInt(Field.IntSize, meta.size || 0);
  }
  if (meta.mimeType !== undefined) header.addString(Field.StringMimeType, meta.mimeType);

  if (meta.posixMode !== undefined) header.addInt(Field.IntPosixMode, meta.posixMode);
  if (meta.createdNanos !== undefined) header.addInt(Field.IntCreatedNanos, meta.createdNanos);
  if (meta.modifiedNanos !== undefined) header.addInt(Field.IntModifiedNanos, meta.modifiedNanos);
  if (meta.accessedNanos !== undefined) header.addInt(Field.IntAccessedNanos, meta.accessedNanos);

  if (meta.username !== undefined) header.addString(Field.StringPosixUsername, meta.username);
  if (meta.groupname !== undefined) header.addString(Field.StringPosixGroupname, meta.groupname);

  return header;
}

// build a file bottle header out of an fs.Stats object.
export function statsToMetadata(filename: string, stats: fs.Stats): FileMetadata {
  const meta: FileMetadata = {
    // for mysterious reasons, isDirectory() must be checked first, before it decays away.
    folder: stats.isDirectory(),
    filename,
    size: stats.size,

    posixMode: stats.mode & 0x1ff,
    createdNanos: stats.ctime.getTime() * 1000000,
    modifiedNanos: stats.mtime.getTime() * 1000000,
    accessedNanos: stats.atime.getTime() * 1000000,
  };

  try {
    meta.username = posix.getpwnam(stats.uid).name;
  } catch (error) {
    // pass
  }

  try {
    meta.groupname = posix.getgrnam(stats.gid).name;
  } catch (error) {
    // pass
  }

  return meta;
}

function decodeFileHeader(header: Header): FileMetadata {
  const meta: FileMetadata = {
    folder: header.getBoolean(Field.BoolIsFolder),
    filename: header.getString(Field.StringFilename) || "?",
  };

  const mimeType = header.getString(Field.StringMimeType);
  if (mimeType !== undefined) meta.mimeType = mimeType;
  const size = header.getInt(Field.IntSize);
  if (size !== undefined) meta.size = size;

  const posixMode = header.getInt(Field.IntPosixMode);
  if (posixMode !== undefined) meta.posixMode = posixMode;
  const createdNanos = header.getInt(Field.IntCreatedNanos);
  if (createdNanos !== undefined) meta.createdNanos = createdNanos;
  const modifiedNanos = header.getInt(Field.IntModifiedNanos);
  if (modifiedNanos !== undefined) meta.modifiedNanos = modifiedNanos;
  const accessedNanos = header.getInt(Field.IntAccessedNanos);
  if (accessedNanos !== undefined) meta.accessedNanos = accessedNanos;

  const username = header.getString(Field.StringPosixUsername);
  if (username !== undefined) meta.username = username;
  const groupname = header.getString(Field.StringPosixGroupname);
  if (groupname !== undefined) meta.groupname = groupname;

  return meta;
}
