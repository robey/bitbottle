"use strict";

import { compoundStream, PullTransform, sourceStream, Transform, weld } from "stream-toolkit";
import { packHeader, unpackHeader } from "./bottle_header";
import { framingStream, unframingStream } from "./framed_stream";
import bufferingStream from "./buffering_stream";

export const MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ]);
export const VERSION = 0x00;

export const TYPE_FILE = 0;
export const TYPE_HASHED = 1;
export const TYPE_ENCRYPTED = 3;
export const TYPE_COMPRESSED = 4;

const MIN_BUFFER = 1024;

export function bottleTypeName(n) {
  switch (n) {
    case TYPE_FILE: return "file";
    case TYPE_HASHED: return "hashed";
    case TYPE_ENCRYPTED: return "encrypted";
    case TYPE_COMPRESSED: return "compressed";
    default: return n.toString();
  }
}

const BOTTLE_END = 0xff;

/*
 * Stream transform that accepts child streams and emits them as a single
 * bottle stream with a header.
 */
export function bottleWriter(type, header, options = {}) {
  const streamOptions = {
    name: "bottleWriterGuts",
    writableObjectMode: true,
    readableObjectMode: true,
    transform: inStream => {
      // prevent tiny packets by requiring it to buffer at least 1KB
      const bufferStream = bufferingStream(MIN_BUFFER);
      const framedStream = framingStream();
      transform.__log("writing stream " + (inStream.__name || "?") + " into " + framedStream.__name);
      inStream.pipe(bufferStream);
      bufferStream.pipe(framedStream);
      return framedStream;
    },
    flush: () => {
      transform.__log("end of bottle");
      return sourceStream(new Buffer([ BOTTLE_END ]));
    }
  };
  for (const k in options) streamOptions[k] = options[k];

  const transform = new Transform(streamOptions);
  transform.push(sourceStream(writeHeader(type, header)));
  const outStream = compoundStream();
  return weld(transform, outStream, {
    name: `BottleWriter(${bottleTypeName(type)})`,
    writableObjectMode: true
  });
}

function writeHeader(type, header) {
  if (type < 0 || type > 15) throw new Error(`Bottle type out of range: ${type}`);
  const buffer = packHeader(header);
  if (buffer.length > 4095) throw new Error(`Header too long: ${buffer.length} > 4095`);
  return Buffer.concat([
    MAGIC,
    new Buffer([
      VERSION,
      0,
      (type << 4) | ((buffer.length >> 8) & 0xf),
      (buffer.length & 0xff)
    ]),
    buffer
  ]);
}

// /*
//  * Converts a Readable stream into a framed data stream with a 4bottle
//  * header/footer. Write buffers, read buffers. This is a convenience version
//  * of BottleWriter for the case (like a compression stream) where there will
//  * be exactly one nested bottle.
//  */
// export class LoneBottleWriter extends BottleWriter {
//   constructor(type, header, options = {}) {
//     if (options.objectModeRead == null) options.objectModeRead = false;
//     if (options.objectModeWrite == null) options.objectModeWrite = false;
//     super(type, header, options);
//     // make a single framed stream that we channel
//     this.framedStream = framed_stream.writableFramedStream();
//     this.__log("writing (lone) stream into " + this.framedStream.__name);
//     this.framedStream.on("data", data => this.push(data);
//   }
//
//   _transform(data, _, callback) {
//     this.framedStream.write(data, _, callback);
//   }
//
//   _flush(callback) {
//     this.framedStream.end();
//     this.framedStream.on("end", () => {
//       this.__log("end lone.");
//       this._close();
//       callback();
//     });
//   }
// }


/*
 * Stream transform that accepts a byte stream and emits a header, then one
 * or more child streams.
 */
export function bottleReader(options = {}) {
  const streamOptions = {
    readableObjectMode: true,
    transform: t => {
      return readHeader(t).then(header => {
        t.push(header);
        return next(t);
      });
    }
  };
  for (const k in options) streamOptions[k] = options[k];
  return new PullTransform(streamOptions);

  function next(t) {
    return t.get(1).then(byte => {
      if (!byte || byte[0] == BOTTLE_END) {
        t.push(null);
        return;
      }
      // put it back. it's part of a data stream!
      t.unget(byte);

      // unframe and emit.
      const unframing = unframingStream();
      t.subpipe(unframing);
      t.push(unframing);
      return unframing.endPromise().then(() => next(t));
    });
  }
}

function readHeader(transform) {
  transform.__log("readBottleHeader");
  return transform.get(8).then(buffer => {
    if (!buffer || buffer.length < 8) throw new Error("End of stream");
    for (let i = 0; i < 4; i++) {
      if (buffer[i] != MAGIC[i]) throw new Error("Incorrect magic (not a 4bottle archive)");
    }
    if (buffer[4] != VERSION) throw new Error(`Incompatible version: ${buffer[4].toString(16)}`);
    if (buffer[5] != 0) throw new Error(`Incompatible flags: ${buffer[5].toString(16)}`);
    const type = (buffer[6] >> 4) & 0xf;
    const headerLength = ((buffer[6] & 0xf) * 256) + (buffer[7] & 0xff);
    return transform.get(headerLength).then(headerBuffer => {
      const rv = { type, header: unpackHeader(headerBuffer || new Buffer(0)) };
      if (transform.__debug) transform.__log("readBottleHeader -> " + type + ", " + rv.header.toString());
      return rv;
    });
  });
}

// // read a bottle from a stream, returning a BottleReader object, which is
// // a stream that provides sub-streams.
// export function readBottleFromStream(stream) {
//   // avoid import loops.
//   const file_bottle = require("./file_bottle");
//   const hash_bottle = require("./hash_bottle");
//   const encrypted_bottle = require("./encrypted_bottle");
//   const compressed_bottle = require("./compressed_bottle");
//
//   return readBottleHeader(stream).then(({ type, header }) => {
//     switch (type) {
//       case TYPE_FILE:
//         return new BottleReader(type, file_bottle.decodeFileHeader(header), stream);
//       case TYPE_HASHED:
//         return new hash_bottle.HashBottleReader(hash_bottle.decodeHashHeader(header), stream);
//       case TYPE_ENCRYPTED:
//         return new encrypted_bottle.EncryptedBottleReader(encrypted_bottle.decodeEncryptionHeader(header), stream);
//       case TYPE_COMPRESSED:
//         return new compressed_bottle.CompressedBottleReader(compressed_bottle.decodeCompressedHeader(header), stream);
//       default:
//         return new BottleReader(type, header, stream);
//     }
//   });
// }
//

//
//
// // stream that reads an underlying (buffer) stream, pulls out the header and
// // type, and generates data streams.
// export class BottleReader extends stream.Readable {
//   constructor(type, header, stream) {
//     super({ objectMode: true });
//     this.type = type;
//     this.header = header;
//     this.stream = stream;
//     this.lastPromise = Promise.resolve();
//     toolkit.promisify(this, { name: "BottleReader(" + this.typeName() + ")" });
//     this.__log(`${this.__name} reading from ${this.stream.__name || "???"}`);
//   }
//
//   toString() {
//     return this.__name;
//   }
//
//   // usually subclasses will override this.
//   typeName() {
//     switch (this.type) {
//       case TYPE_FILE:
//         return this.header.folder ? "folder" : "file";
//       default:
//         return `unknown(${this.type})`;
//     }
//   }
//
//   _read(size) {
//     this.__log("_read(" + size + ")");
//     return this._nextStream();
//   }
//
//   _nextStream() {
//     // must finish reading the last thing we generated, if any:
//     this.__log("wait for inner stream to end");
//     return this.lastPromise.then(() => {
//       this.__log("inner stream ended! reading next data stream");
//       return this._readDataStream();
//     }).then(stream => {
//       if (!stream) {
//         // just in case we're tripping that io.js bug, read 0 bytes, to trigger the 'end' signal.
//         this.stream.read(0);
//         this.__log("end of stream");
//         this.push(null);
//         return;
//       }
//       this.__log("pushing new stream: " + (stream.__name || "?"));
//       this.lastPromise = stream.endPromise();
//       this.push(stream);
//     }).catch(error => {
//       this.emit("error", error);
//     });
//   }
//
//   drain() {
//     return this.readPromise(1).then(stream => {
//       if (!stream) return;
//       const sink = toolkit.nullSinkStream();
//       stream.pipe(sink);
//       return sink.endPromise().then(() => {
//         return this.drain();
//       });
//     });
//   }

// }
