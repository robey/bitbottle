"use strict";

import Promise from "bluebird";
import stream from "stream";
import toolkit from "stream-toolkit";
import util from "util";
import * as bottle_header from "./bottle_header";
import * as framed_stream from "./framed_stream";
import * as zint from "./zint";

export const MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ]);
export const VERSION = 0x00;

export const TYPE_FILE = 0;
export const TYPE_HASHED = 1;
export const TYPE_ENCRYPTED = 3;
export const TYPE_COMPRESSED = 4;

const BOTTLE_END = 0xff;


/*
 * Converts (Readable) stream objects into a stream of framed data blocks with
 * a 4bottle header/footer. Write Readable streams, read buffers.
 */
export class BottleWriter extends stream.Transform {
  constructor(type, header, options = {}) {
    super(options);
    toolkit.promisify(this, { name: "BottleWriter(" + type + ")" });
    this._writableState.objectMode = options.objectModeWrite ? options.objectModeWrite : true;
    this._readableState.objectMode = options.objectModeRead ? options.objectModeRead : false;
    this._writeHeader(type, header);
  }

  _writeHeader(type, header) {
    if (type < 0 || type > 15) throw new Error(`Bottle type out of range: ${type}`);
    if (this.__debug) this.__log("writeHeader: type=" + type + " header=" + header.toString());
    const buffers = header.pack();
    const length = buffers.length == 0 ? 0 : buffers.map((b) => b.length).reduce((a, b) => a + b);
    if (length > 4095) throw new Error(`Header too long: ${length} > 4095`);
    this.push(MAGIC);
    this.push(new Buffer([
      VERSION,
      0,
      (type << 4) | ((length >> 8) & 0xf),
      (length & 0xff)
    ]));
    buffers.map((b) => this.push(b));
  }

  _transform(inStream, _, callback) {
    this._process(inStream).then(() => {
      callback();
    }).catch((error) => {
      callback(error);
    });
  }

  // write a data stream into this bottle.
  // ("subclasses" may use this to handle their own magic)
  _process(inStream) {
    const framedStream = framed_stream.writableFramedStream();
    this.__log("writing stream into " + framedStream.__name);
    framedStream.on("data", (data) => this.push(data));
    inStream.pipe(framedStream);
    return framedStream.endPromise();
  }

  _flush(callback) {
    this._close();
    callback();
  }

  _close() {
    this.__log("end of bottle");
    this.push(new Buffer([ BOTTLE_END ]));
  }
}


// Converts a Readable stream into a framed data stream with a 4Q bottle
// header/footer. Write buffers, read buffers. This is a convenience version
// of BottleWriter for the case (like a compression stream) where there will
// be exactly one nested bottle.
export class LoneBottleWriter extends BottleWriter {
  constructor(type, header, options = {}) {
    if (options.objectModeRead == null) options.objectModeRead = false;
    if (options.objectModeWrite == null) options.objectModeWrite = false;
    super(type, header, options);
    // make a single framed stream that we channel
    this.framedStream = framed_stream.writableFramedStream();
    this.__log("writing (lone) stream into " + this.framedStream.__name);
    this.framedStream.on("data", (data) => this.push(data));
  }

  _transform(data, _, callback) {
    this.framedStream.write(data, _, callback);
  }

  _flush(callback) {
    this.framedStream.end();
    this.framedStream.on("end", () => {
      this._close();
      callback();
    });
  }
}


// read a bottle from a stream, returning a BottleReader object, which is
// a stream that provides sub-streams.
export function readBottleFromStream(stream) {
  // avoid import loops.
  const file_bottle = require("./file_bottle");
  const hash_bottle = require("./hash_bottle");
  const encrypted_bottle = require("./encrypted_bottle");
  const compressed_bottle = require("./compressed_bottle");

  return readBottleHeader(stream).then(({ type, header }) => {
    switch (type) {
      case TYPE_FILE:
        return new BottleReader(type, file_bottle.decodeFileHeader(header), stream);
      case TYPE_HASHED:
        return new hash_bottle.HashBottleReader(hash_bottle.decodeHashHeader(header), stream);
      case TYPE_ENCRYPTED:
        return new encrypted_bottle.EncryptedBottleReader(encrypted_bottle.decodeEncryptionHeader(header), stream);
      case TYPE_COMPRESSED:
        return new compressed_bottle.CompressedBottleReader(compressed_bottle.decodeCompressedHeader(header), stream);
      default:
        return new BottleReader(type, header, stream);
    }
  });
}

function readBottleHeader(stream) {
  toolkit.promisify(stream, { name: "BottleHeader" });
  stream.__log("readBottleHeader");
  return stream.readPromise(8).then((buffer) => {
    if (!buffer) throw new Error("End of stream");
    for (let i = 0; i < 4; i++) {
      if (buffer[i] != MAGIC[i]) throw new Error("Incorrect magic (not a 4Q archive)");
    }
    if (buffer[4] != VERSION) throw new Error(`Incompatible version: ${buffer[4].toString(16)}`);
    if (buffer[5] != 0) throw new Error(`Incompatible flags: ${buffer[5].toString(16)}`);
    const type = (buffer[6] >> 4) & 0xf;
    const headerLength = ((buffer[6] & 0xf) * 256) + (buffer[7] & 0xff);
    return stream.readPromise(headerLength).then((headerBuffer) => {
      const rv = { type, header: bottle_header.unpack(headerBuffer) };
      if (stream.__debug) stream.__log("readBottleHeader -> " + util.inspect(rv, { depth: null }));
      return rv;
    });
  });
}


// stream that reads an underlying (buffer) stream, pulls out the header and
// type, and generates data streams.
export class BottleReader extends stream.Readable {
  constructor(type, header, stream) {
    super({ objectMode: true });
    this.type = type;
    this.header = header;
    this.stream = stream;
    this.lastPromise = Promise.resolve();
    toolkit.promisify(this, { name: "BottleReader(" + this.typeName() + ")" });
    this.__log(`${this.__name} reading from ${this.stream.__name || "???"}`);
  }

  toString() {
    return this.__name;
  }

  // usually subclasses will override this.
  typeName() {
    switch (this.type) {
      case TYPE_FILE:
        return this.header.folder ? "folder" : "file";
      default:
        return `unknown(${this.type})`;
    }
  }

  _read(size) {
    this.__log("_read(" + size + ")");
    return this._nextStream();
  }

  _nextStream() {
    // must finish reading the last thing we generated, if any:
    this.__log("wait for inner stream to end");
    return this.lastPromise.then(() => {
      this.__log("inner stream ended! reading next data stream");
      return this._readDataStream();
    }).then(stream => {
      if (!stream) {
        // just in case we're tripping that io.js bug, read 0 bytes, to trigger the 'end' signal.
        this.stream.read(0);
        this.__log("end of stream");
        this.push(null);
        return;
      }
      this.__log("pushing new stream: " + (stream.__name || "?"));
      this.lastPromise = stream.endPromise();
      this.push(stream);
    }).catch(error => {
      this.emit("error", error);
    });
  }

  drain() {
    return this.readPromise(1).then(stream => {
      if (!stream) return;
      const sink = toolkit.nullSinkStream();
      stream.pipe(sink);
      return sink.endPromise().then(() => {
        return this.drain();
      });
    });
  }

  _readDataStream() {
    return this.stream.readPromise(1).then((buffer) => {
      this.__log("stream header: " + buffer[0]);
      if (!buffer || buffer[0] == BOTTLE_END) return null;
      // put it back. it's part of a data stream!
      this.stream.unshift(buffer);
      return framed_stream.readableFramedStream(this.stream);
    });
  }
}
