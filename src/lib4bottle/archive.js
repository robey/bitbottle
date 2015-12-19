"use strict";

import events from "events";
import fs from "fs";
import path from "path";
import Promise from "bluebird";
import rx from "rx";
import { countingStream, nullSinkStream } from "stream-toolkit";
import { bottleReader, TYPE_COMPRESSED, TYPE_ENCRYPTED, TYPE_FILE, TYPE_HASHED } from "./bottle_stream";
import { decodeCompressionHeader, readCompressedBottle } from "./compressed_bottle";
import { decodeEncryptionHeader, encryptedBottleReader } from "./encrypted_bottle";
import { decodeFileHeader, fileBottleWriter, fileHeaderFromStats, folderBottleWriter } from "./file_bottle";
import { decodeHashHeader, hashBottleReader } from "./hash_bottle";

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
 * Read an archive from a stream and generate an rx 'Observable'. The
 * Observable generates events for each file, and when it enters and exits
 * sections for folders, compression, encryption, or hash validation.
 *
 * Options:
 *   - `key`: `Buffer` the key to use for decryption, if you have one already
 *   - `decrypter`: `(keymap: Map(String, Buffer)) => Promise(Buffer)`
 *     function to generate an decrypted key, given a map of recipients to
 *     encrypted keys
 *   - `getPassword`: `() => Promise(String)` requested when the key is
 *     encrypted with scrypt
 *   - `verifier`: `(Buffer, signedBy: String) => Promise(Buffer)`: if the
 *     hash was signed, unpack the signature, verify that it was signed by
 *     `signedBy`, and return either the signed data or an exception
 *
 * Events are emitted with at least these fields:
 *   - `event`: name of the event (listed below)
 *   - `header`: bottle-dependent header (filename, encryption type, and so
 *     on)
 *
 * Events:
 *   - `enter-folder`: subsequent files will be located within this named
 *     folder, until the corresponding `exit-folder`
 *   - `exit-folder`: leaving the named folder
 *   - `file`: event contains a `stream` field with the file's contents
 *   - `enter-hash`: entering a hash-validated or signed section (will use
 *     `options` to validate any signature)
 *   - `valid-hash`: exiting a hash-validated or signed section successfully;
 *     the `hex` field contains the section's valid hash
 *   - `invalid-hash`: exiting a hash-validated or signed section
 *     unsuccessfully; the `error` field contains the error
 *   - `enter-encrypt`: entering an encrypted section (will use `options` to
 *     decrypt)
 *   - `exit-encrypt`: leaving an encrypted section
 *   - `enter-compress`: entering a compressed section
 *   - `exit-compress`: leaving a compressed section
 *
 * Because the archive is read as a stream, each `file` event must have its
 * stream object drained before the next event can be emitted.
 */
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
        return scanBottle(type, header, bottle);
      }).catch(error => {
        observer.onError(error);
        throw error;
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
            return bottle.readPromise(1).then(stream => {
              if (stream == null) return bottle.endPromise();
              observer.onNext({ event: "file", header, stream });
              return stream.endPromise().then(() => drainBottle(bottle));
            });
          }
          break;

        case TYPE_HASHED:
          header = decodeHashHeader(header);
          observer.onNext({ event: "enter-hash", header });
          return hashBottleReader(header, bottle, options).then(({ stream, hexPromise }) => {
            return scanStream(stream).then(() => drainBottle(bottle)).then(() => hexPromise).then(hex => {
              observer.onNext({ event: "valid-hash", header, hex });
            }, error => {
              observer.onNext({ event: "invalid-hash", header, error });
            });
          });

        case TYPE_ENCRYPTED:
          header = decodeEncryptionHeader(header);
          observer.onNext({ event: "enter-encrypt", header });
          return encryptedBottleReader(header, bottle, options).then(nextStream => {
            return scanStream(nextStream).then(() => drainBottle(bottle));
          }).then(() => {
            observer.onNext({ event: "exit-encrypt", header });
          });

        case TYPE_COMPRESSED:
          header = decodeCompressionHeader(header);
          observer.onNext({ event: "enter-compress", header });
          return readCompressedBottle(header, bottle).then(stream => {
            return scanStream(stream).then(() => drainBottle(bottle));
          }).then(() => {
            observer.onNext({ event: "exit-compress", header });
          });

        default:
          observer.onNext({ event: "unknown", type, header });
          return drainBottle(bottle);
      }
    }

    // recurse through every nested bottle.
    function scanFolder(bottle) {
      return bottle.readPromise(1).then(stream => {
        if (stream == null) return bottle.endPromise();
        return scanStream(stream).then(() => scanFolder(bottle));
      });
    }
  });
}

// skip any remaining streams in this bottle.
function drainBottle(bottle) {
  return bottle.readPromise(1).then(s => {
    if (s == null) return bottle.endPromise();
    const sink = nullSinkStream();
    s.pipe(sink);
    return sink.finishPromise().then(() => drainBottle(bottle));
  });
}
