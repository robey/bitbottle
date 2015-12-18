"use strict";

import events from "events";
import fs from "fs";
import path from "path";
import Promise from "bluebird";
import rx from "rx";
import { countingStream, nullSinkStream } from "stream-toolkit";
import { bottleReader, TYPE_ENCRYPTED, TYPE_FILE } from "./bottle_stream";
import { decodeEncryptionHeader, encryptedBottleReader } from "./encrypted_bottle";
import { decodeFileHeader, fileBottleWriter, fileHeaderFromStats, folderBottleWriter } from "./file_bottle";

const openPromise = Promise.promisify(fs.open);
const readdirPromise = Promise.promisify(fs.readdir);
const statPromise = Promise.promisify(fs.stat);

const BUFFER_SIZE = Math.pow(10, 6);

// higher-level API for maniplating 4bottle archives of files & folders.

/*
 * Create a file or folder bottle stream.
 *
 * Events are emitted for:
 *   - `filename`
 *     - `(filename, header)` - begin processing a new file
 *   - `status`
 *     - `(filename, byteCount)` - bytes read so far from the current file
 *   - `error`
 *     - `(error: Error)` - an error occurred during the data streaming
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
    return statPromise(filename).then(stats => {
      const header = fileHeaderFromStats(basename, stats);
      const displayName = (prefix ? path.join(prefix, basename) : basename) + (header.folder ? "/" : "");
      this.emit("filename", displayName, header);
      if (header.folder) return this._processFolder(filename, displayName, header);
      return openPromise(filename, "r").then(fd => {
        const countingFileStream = countingStream();
        countingFileStream.on("count", n => {
          this.emit("status", displayName, n);
        });
        const fileBottle = fileBottleWriter(header);
        fs.createReadStream(filename, { fd, highWaterMark: BUFFER_SIZE }).pipe(countingFileStream);
        fileBottle.write(countingFileStream);
        fileBottle.end();
        return fileBottle;
      });
    });
  }

  _processFolder(folderName, prefix, header, files = null) {
    return (files ? Promise.resolve(files) : readdirPromise(folderName)).then(files => {
      const folderBottle = folderBottleWriter(header);
      // fill the bottle in the background, closing it when done.
      Promise.map(files, filename => {
        const fullPath = folderName ? path.join(folderName, filename) : filename;
        return this._processFile(fullPath, prefix).then(fileStream => {
          return folderBottle.writePromise(fileStream);
        });
      }, { concurrency: 1 }).then(() => {
        return folderBottle.end();
      }).catch(error => {
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
 * Read an archive from a stream.
 *
 * Options:
 *   - `processFile: ({ fileHeader, stream }) => Promise()`
 *     - process the data stream of a file, and return a Promise that
 *       indicates that the stream has been completely read (default behavior
 *       is to read the stream into a bit bucket and move on)
 *   - `key`: `Buffer`
 *     - the key to use for decryption, if you have one already
 *   - `decrypter`: `(keymap: Map(String, Buffer)) => Promise(Buffer)`
 *     - function to generate an decrypted key, given a map of recipients to
 *       encrypted keys
 *   - `getPassword`: `() => Promise(String)`
 *     - requested when the key is encrypted with scrypt

 *   - `verify: (Buffer, signedBy: String) => Promise(Buffer)`
 *     - unpack a signature buffer and verify that it was signed by the name
 *       given, returning the original signed data (or an exception)
 *
 * Events are emitted for:
 *   - `start-bottle`
 *     - `({ type, header })` - beginning processing of a bottle
 *   - `end-bottle`
 *     - `({ type, header })` - done processing a bottle
 *   - `error`
 *     - `Error` - caught an error during processing
 *   - `skip`
 *     - `({ type, header })` - unknown bottle type, skipping
 *   - `hash`
 *     - `(bottle: BottleReader, isValid, hex)` - after validating a hashed
 *       bottle
 *   - `encrypt`
 *     - `({ type, header })` - before attempting to decrypt an encrypted
 *       bottle
 *   - `compress`
 *     - `(bottle: BottleReader)` - before uncompressing a compressed bottle
 *
 * callbacks:
 *   - processFile(dataStream) -> handle contents of a file, return a promise for completion
 *   - decryptKey(keyMap) -> decrypt one of these buffers if possible
 */
export class ArchiveReader extends events.EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      processFile: dataStream => {
        // default: just skip this stream.
        const sink = nullSinkStream();
        dataStream.pipe(sink);
        return sink.finishPromise();
      },
      verify: () => {
        // FIXME: maybe this isn't an error, but a warning?
        return Promise.reject(new Error("Can't verify signed bottle"));
      }
    };
    for (const k in options) this.options[k] = options[k];
  }

  scanStream(inStream, options = {}) {
    const bottle = bottleReader(options);
    inStream.pipe(bottle);
    return bottle.readPromise(1).then(({ type, header }) => {
      this.emit("start-bottle", { type, header });
      return this._scan(type, header, bottle).then(() => {
        this.emit("end-bottle", { type, header });
      }, error => {
        this.emit("error", error);
      });
    });
  }

  _scan(type, header, bottle) {
    switch (type) {
      case TYPE_FILE:
        return header.folder ? this._scanFolder(type, header, bottle) : this._scanFile(type, header, bottle);
      case TYPE_ENCRYPTED:
        return this._scanEncrypted(type, header, bottle);
      default:
        this.emit("skip", { type, header });
        return this._skipBottle(bottle);
    }
  }

  // scan(bottle) {
  //   switch (bottle.type) {
  //     case TYPE_HASHED:
  //       promise = this._scanHashed(bottle);
  //       break;
  //     case TYPE_ENCRYPTED:
  //       promise = this._scanEncrypted(bottle);
  //       break;
  //     case TYPE_COMPRESSED:
  //       promise = this._scanCompressed(bottle);
  //       break;
  //   }
  // }

  // scan each internal stream recursively.
  _scanFolder(type, header, bottle) {
    return bottle.readPromise(1).then(nextStream => {
      if (nextStream == null) return bottle.endPromise();
      return this.scanStream(nextStream).then(() => this._scanFolder(type, header, bottle));
    });
  }

  _scanFile(type, header, bottle) {
    return bottle.readPromise(1).then(nextStream => {
      if (nextStream == null) return bottle.endPromise();
      const fileHeader = decodeFileHeader(header);
      return this.options.processFile({ fileHeader, stream: nextStream }).then(() => {
        return this._scanFile(type, header, bottle);
      });
    });
  }

  // _scanHashed(bottle) {
  //   return bottle.validate(this.verify).then(({ bottle: innerBottle, valid: validPromise, hex: hexPromise }) => {
  //     return this.scan(innerBottle).then(() => {
  //       return validPromise.then(isValid => {
  //         return hexPromise.then(hex => {
  //           this.emit("hash", bottle, isValid, hex);
  //         });
  //       });
  //     });
  //   }).then(() => bottle.drain());
  // }

  _scanEncrypted(type, header, bottle) {
    const decodedHeader = decodeEncryptionHeader(header);
    this.emit("encrypt", { type, header: decodedHeader });
    return encryptedBottleReader(decodedHeader, bottle, this.options).then(stream => {
      return this.scanStream(stream).then(() => this._skipBottle(bottle));
    });
  }

  _scanCompressed(bottle) {
    this.emit("compress", bottle);
    return bottle.decompress().then(nextBottle => {
      return this.scan(nextBottle);
    }).then(() => bottle.drain());
  }

  _skipBottle(bottle) {
    return bottle.readPromise(1).then(s => {
      if (s == null) return bottle.endPromise();
      const sink = nullSinkStream();
      s.pipe(sink);
      return sink.endPromise().then(() => this._skipBottle(bottle));
    });
  }
}




export function scanArchive(stream, options = {}) {
  return rx.Observable.create(observer => {
    return scanStream(stream).then(() => {
      observer.onCompleted();
    }, () => {
      // error.
      observer.onCompleted();
    });

    function scanStream(substream) {
      const bottle = bottleReader(options);
      substream.pipe(bottle);
      return bottle.readPromise(1).then(({ type, header }) => {
        observer.onNext({ event: "start", type, header });
        return scanBottle(type, header, bottle).then(() => {
          observer.onNext({ event: "end", type, header });
        }, error => {
          observer.onError(error);
          throw error;
        });
      });
    }

    function scanBottle(type, header, bottle) {
      switch (type) {
        case TYPE_FILE:
          header = decodeFileHeader(header);
          if (header.folder) {
            observer.onNext({ event: "enter-folder", header });
            return scanFolder(bottle).then(() => {
              observer.onNext({ event: "exit-folder", header });
            });
          } else {
            return bottle.readPromise(1).then(nextStream => {
              if (nextStream == null) return bottle.endPromise();
              observer.onNext({ event: "file", header, stream: nextStream });
              return nextStream.endPromise().then(() => drainBottle(bottle));
            });
          }
          break;

        case TYPE_ENCRYPTED:
          header = decodeEncryptionHeader(header);
          observer.onNext({ event: "encrypt", header });
          return encryptedBottleReader(header, bottle, options).then(nextStream => {
            return scanStream(nextStream).then(() => drainBottle(bottle));
          });

        default:
          observer.onNext({ event: "unknown", type, header });
          return drainBottle(observer, bottle);
      }
    }

    // recurse through every nested bottle.
    function scanFolder(bottle) {
      return bottle.readPromise(1).then(nextStream => {
        if (nextStream == null) return bottle.endPromise();
        return scanStream(nextStream).then(() => scanFolder(bottle));
      });
    }
  });
}

// skip any remaining streams in this bottle.
function drainBottle(bottle) {
  console.log("drain");
  return bottle.readPromise(1).then(s => {
    console.log("got:", s);
    if (s == null) return bottle.endPromise();
    const sink = nullSinkStream();
    s.pipe(sink);
    return sink.finishPromise().then(() => drainBottle(bottle));
  });
}
