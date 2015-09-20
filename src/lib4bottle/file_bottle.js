"use strict";

import * as bottle_header from "./bottle_header";
import * as bottle_stream from "./bottle_stream";
import posix from "posix";

const FIELDS = {
  STRINGS: {
    FILENAME: 0,
    MIME_TYPE: 1,
    POSIX_USERNAME: 2,
    POSIX_GROUPNAME: 3
  },
  NUMBERS: {
    SIZE: 0,
    POSIX_MODE: 1,
    CREATED_NANOS: 2,
    MODIFIED_NANOS: 3,
    ACCESSED_NANOS: 4
  },
  BOOLS: {
    IS_FOLDER: 0
  }
};


// build a file bottle header out of an fs.Stats object.
export function fileHeaderFromStats(filename, stats) {
  // for mysterious reasons, isDirectory() must be checked first, before it decays away.
  stats.folder = stats.isDirectory();
  stats.filename = filename;
  stats.mode = stats.mode & 0x1ff;
  stats.createdNanos = stats.ctime.getTime() * 1000000;
  stats.modifiedNanos = stats.mtime.getTime() * 1000000;
  stats.accessedNanos = stats.atime.getTime() * 1000000;
  stats.username = null;
  try {
    stats.username = posix.getpwnam(stats.uid).name;
  } catch (error) {
    // pass
  }
  stats.groupname = null;
  try {
    stats.groupname = posix.getgrnam(stats.gid).name;
  } catch (error) {
    // pass
  }
  return stats;
}

export function encodeFileHeader(stats, overrides) {
  for (const key in overrides) stats[key] = overrides[key];
  const m = new bottle_header.Header();
  m.addString(FIELDS.STRINGS.FILENAME, stats.filename);
  if (stats.mode) m.addNumber(FIELDS.NUMBERS.POSIX_MODE, stats.mode);
  if (stats.createdNanos) m.addNumber(FIELDS.NUMBERS.CREATED_NANOS, stats.createdNanos);
  if (stats.modifiedNanos) m.addNumber(FIELDS.NUMBERS.MODIFIED_NANOS, stats.modifiedNanos);
  if (stats.accessedNanos) m.addNumber(FIELDS.NUMBERS.ACCESSED_NANOS, stats.accessedNanos);
  if (stats.folder) {
    m.addBool(FIELDS.BOOLS.IS_FOLDER);
  } else {
    m.addNumber(FIELDS.NUMBERS.SIZE, stats.size);
  }
  if (stats.username) m.addString(FIELDS.STRINGS.POSIX_USERNAME, stats.username);
  if (stats.groupname) m.addString(FIELDS.STRINGS.POSIX_GROUPNAME, stats.groupname);
  return m;
}

export function decodeFileHeader(m) {
  const rv = { folder: false };
  m.fields.forEach((field) => {
    switch (field.type) {
      case bottle_header.TYPE_STRING:
        switch (field.id) {
          case FIELDS.STRINGS.FILENAME:
            rv.filename = field.list[0];
            break;
          case FIELDS.STRINGS.MIME_TYPE:
            rv.mimeType = field.list[0];
            break;
          case FIELDS.STRINGS.POSIX_USERNAME:
            rv.username = field.list[0];
            break;
          case FIELDS.STRINGS.POSIX_GROUPNAME:
            rv.groupname = field.list[0];
            break;
        }
        break;
      case bottle_header.TYPE_ZINT:
        switch (field.id) {
          case FIELDS.NUMBERS.SIZE:
            rv.size = field.number;
            break;
          case FIELDS.NUMBERS.POSIX_MODE:
            rv.mode = field.number;
            break;
          case FIELDS.NUMBERS.CREATED_NANOS:
            rv.createdNanos = field.number;
            break;
          case FIELDS.NUMBERS.MODIFIED_NANOS:
            rv.modifiedNanos = field.number;
            break;
          case FIELDS.NUMBERS.ACCESSED_NANOS:
            rv.accessedNanos = field.number;
            break;
        }
        break;
      case bottle_header.TYPE_BOOL:
        switch (field.id) {
          case FIELDS.BOOLS.IS_FOLDER:
            rv.folder = true;
            break;
        }
        break;
    }
  });
  return rv;
}


// wrap a single file stream (with its metadata) into a FileBottle.
export class FileBottleWriter extends bottle_stream.LoneBottleWriter {
  constructor(header) {
    super(bottle_stream.TYPE_FILE, encodeFileHeader(header, { folder: false }));
  }
}

// FileBottle that contains multiple nested streams (usually other FileBottles).
export class FolderBottleWriter extends bottle_stream.BottleWriter {
  constructor(header) {
    super(bottle_stream.TYPE_FILE, encodeFileHeader(header, { folder: true }));
  }
}
