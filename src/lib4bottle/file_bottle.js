"use strict";

import { Header, TYPE_BOOL, TYPE_STRING, TYPE_ZINT } from "./bottle_header";
import { bottleWriter, TYPE_FILE } from "./bottle_stream";
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


// wrap a single file stream (with its metadata) into a FileBottle.
export function writeFileBottle(stats) {
  return bottleWriter(TYPE_FILE, encodeFileHeader(stats, { folder: false }));
}

export function writeFolderBottle(stats) {
  return bottleWriter(TYPE_FILE, encodeFileHeader(stats, { folder: true }));
}

export function encodeFileHeader(stats, overrides) {
  for (const key in overrides) stats[key] = overrides[key];
  const header = new Header();
  header.addString(FIELDS.STRINGS.FILENAME, stats.filename);
  if (stats.mode) header.addNumber(FIELDS.NUMBERS.POSIX_MODE, stats.mode);
  if (stats.createdNanos) header.addNumber(FIELDS.NUMBERS.CREATED_NANOS, stats.createdNanos);
  if (stats.modifiedNanos) header.addNumber(FIELDS.NUMBERS.MODIFIED_NANOS, stats.modifiedNanos);
  if (stats.accessedNanos) header.addNumber(FIELDS.NUMBERS.ACCESSED_NANOS, stats.accessedNanos);
  if (stats.folder) {
    header.addBool(FIELDS.BOOLS.IS_FOLDER);
  } else {
    header.addNumber(FIELDS.NUMBERS.SIZE, stats.size);
  }
  if (stats.username) header.addString(FIELDS.STRINGS.POSIX_USERNAME, stats.username);
  if (stats.groupname) header.addString(FIELDS.STRINGS.POSIX_GROUPNAME, stats.groupname);
  return header;
}

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

export function decodeFileHeader(header) {
  const rv = { folder: false };
  header.fields.forEach(field => {
    switch (field.type) {
      case TYPE_STRING:
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
      case TYPE_ZINT:
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
      case TYPE_BOOL:
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
