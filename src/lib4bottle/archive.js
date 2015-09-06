"use strict";

import events from "events";
import fs from "fs";
import path from "path";
import Promise from "bluebird";
import stream from "stream";
import toolkit from "stream-toolkit";
import * as bottle_stream from "./bottle_stream";
import * as file_bottle from "./file_bottle";

const openPromise = Promise.promisify(fs.open);
const readdirPromise = Promise.promisify(fs.readdir);
const statPromise = Promise.promisify(fs.stat);

// higher-level API for maniplating 4Q archives of files & folders.

/*
 * Create a file or folder bottle stream, emitting events for:
 *   - "filename", (filename, header) -> begin processing a new file
 *   - "status", (filename, byteCount) -> current # of bytes read from the current file
 *   - "error", (error) -> an error occurred during the data streaming
 */
export class ArchiveWriter extends events.EventEmitter {
  constructor() {
    super();
  }

  /*
   * Write a file into a bottle and return that a promise for that bottle.
   * If it's a plain file, the file's contents are piped in.
   * If it's a folder, a folder bottle is generated, and each file in the
   * folder is added sequentially. (Nested folders are handled recursively.)
   * In each case, the promise is fulfilled before the data is completely
   * written. Handle the "finish" event on the bottle to find out when the
   * bottle has finished writing.
   */
  archiveFile(filename) {
    return this._processFile(filename, null);
  }

  /*
   * Create a fake folder with the given name, and archive a list of files
   * into it, as with `archiveFile`.
   */
  archiveFiles(folderName, filenames) {
    const header = this._makeFakeFolderHeader(folderName);
    const prefix = folderName + "/";
    this.emit("filename", prefix, header);
    return this._processFolder(null, prefix, header, filenames);
  }

  _processFile(filename, prefix) {
    const basename = path.basename(filename);
    return statPromise(filename).then((stats) => {
      const header = file_bottle.fileHeaderFromStats(basename, stats);
      const displayName = (prefix ? path.join(prefix, basename) : basename) + (header.folder ? "/" : "");
      this.emit("filename", displayName, header);
      if (header.folder) return this._processFolder(filename, displayName, header);
      return openPromise(filename, "r").then((fd) => {
        const countingFileStream = toolkit.countingStream();
        countingFileStream.on("count", (n) => {
          this.emit("status", displayName, n);
        });
        const fileBottle = new file_bottle.FileBottleWriter(header);
        fs.createReadStream(filename, { fd }).pipe(countingFileStream).pipe(fileBottle);
        return fileBottle;
      });
    });
  }

  _processFolder(folderName, prefix, header, files = null) {
    return (files ? Promise.resolve(files) : readdirPromise(folderName)).then((files) => {
      const folderBottle = new file_bottle.FolderBottleWriter(header);
      // fill the bottle in the background, closing it when done.
      Promise.map(files, (filename) => {
        const fullPath = folderName ? path.join(folderName, filename) : filename;
        return this._processFile(fullPath, prefix).then((fileStream) => {
          return folderBottle.writePromise(fileStream);
        });
      }, { concurrency: 1 }).then(() => {
        return folderBottle.end();
      }).catch((error) => {
        this.emit("error", error);
      });
      return folderBottle;
    });
  }

  _makeFakeFolderHeader(name) {
    const nowNanos = Date.now() * Math.pow(10, 6);
    const stats = {
      folder: true,
      filename: name,
      mode: 0x1c0,
      createdNanos: nowNanos,
      modifiedNanos: nowNanos,
      accessedNanos: nowNanos
    };
    return stats;
  }
}


/*
 * events:
 * - "start-bottle", (bottle) -> beginning processing of a bottle
 * - "end-bottle", (bottle) -> done processing a bottle
 * - "skip", (bottle) -> unknown bottle type, skipping
 * - "hash", (bottle, isValid, hex) -> after validating a hashed bottle
 * - "encrypt", (bottle) -> before attempting to decrypt an encrypted bottle
 * - "compress", (bottle) -> before uncompressing a compressed bottle
 *
 * callbacks:
 * - processFile(dataStream) -> handle contents of a file, return a promise for completion
 * - decryptKey(keyMap) -> decrypt one of these buffers if possible
 */
export class ArchiveReader extends events.EventEmitter {
  constructor() {
    super();
  }

  scanStream(inStream) {
    return bottle_stream.readBottleFromStream(inStream).then(bottle => {
      return this.scan(bottle);
    });
  }

  scan(bottle) {
    this.emit("start-bottle", bottle);
    let promise = null;
    switch (bottle.type) {
      case bottle_stream.TYPE_FILE:
        promise = bottle.header.folder ? this._scanFolder(bottle) : this._scanFile(bottle);
        break;
      case bottle_stream.TYPE_HASHED:
        promise = this._scanHashed(bottle);
        break;
      case bottle_stream.TYPE_ENCRYPTED:
        promise = this._scanEncrypted(bottle);
        break;
      case bottle_stream.TYPE_COMPRESSED:
        promise = this._scanCompressed(bottle);
        break;
      default:
        promise = this._skipBottle(bottle);
        break;
    }
    return Promise.all([
      // io.js requires a read() to notice end-of-stream.
      promise.then(() => bottle.read(0)),
      bottle.endPromise()
    ]).then(() => {
      this.emit("end-bottle", bottle);
    });
  }

  // scan each internal stream recursively
  _scanFolder(bottle) {
    return bottle.readPromise().then((nextStream) => {
      if (nextStream == null) return;
      return this.scanStream(nextStream).then(() => this._scanFolder(bottle));
    });
  }

  _scanFile(bottle) {
    return bottle.readPromise().then((nextStream) => {
      if (nextStream == null) return;
      return this.processFile(nextStream).then(() => this._scanFile(bottle));
    });
  }

  // override this method to do something besides just skip the stream and move on.
  processFile(dataStream) {
    const sink = toolkit.nullSinkStream();
    dataStream.pipe(sink);
    return sink.finishPromise();
  }

  // given a map of (name -> buffer), where the buffer is an encrypted blob,
  // try to find a name we recognize and can decrypt, and decrypt the buffer,
  // returning it as a promise. reject the promise if we can't.
  decryptKey(keymap) {
    return Promise.reject(new Error("Encrypted bottle; no keys"));
  }

  _scanHashed(bottle) {
    return bottle.validate().then(({ bottle: innerBottle, valid: validPromise, hex: hexPromise }) => {
      return this.scan(innerBottle).then(() => {
        return validPromise.then((isValid) => {
          return hexPromise.then((hex) => {
            this.emit("hash", bottle, isValid, hex);
          });
        });
      });
    });
  }

  _scanEncrypted(bottle) {
    this.emit("encrypt", bottle);
    return bottle.readKeys().then((keymap) => {
      return this.decryptKey(keymap).then((keyBuffer) => {
        return bottle.decrypt(keyBuffer).then((stream) => {
          return bottle_stream.readBottleFromStream(stream).then((bottle) => {
            return this.scan(bottle);
          });
        });
      });
    });
  }

  _scanCompressed(bottle) {
    this.emit("compress", bottle);
    return bottle.decompress().then((nextBottle) => {
      return this.scan(nextBottle);
    });
  }

  _skipBottle(bottle) {
    this.emit("skip", bottle);
    return bottle.readPromise().then((s) => {
      if (s == null) return;
      const sink = new toolkit.NullSinkStream();
      s.pipe(sink);
      return sink.endPromise().then(() => this._skipBottle(bottle));
    });
  }
}


exports.ArchiveReader = ArchiveReader;
exports.ArchiveWriter = ArchiveWriter;
