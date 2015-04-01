const bottle_header = require("./bottle_header");
const framed_stream = require("./framed_stream");
const Promise = require("bluebird");
const stream = require("stream");
const toolkit = require("stream-toolkit");
const util = require("util");
const zint = require("./zint");

const MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ]);
const VERSION = 0x00;

const TYPE_FILE = 0;
const TYPE_HASHED = 1;
const TYPE_ENCRYPTED = 3;
const TYPE_COMPRESSED = 4;

const BOTTLE_END = 0xff;


// Converts (Readable) stream objects into a stream of framed data blocks with
// a 4Q bottle header/footer. Write Readable streams, read buffers.
class BottleWriter extends stream.Transform {
  constructor(type, header, options = {}) {
    super(options);
    toolkit.promisify(this);
    this._writableState.objectMode = options.objectModeWrite ? options.objectModeWrite : true;
    this._readableState.objectMode = options.objectModeRead ? options.objectModeRead : false;
    this._writeHeader(type, header);
  }

  _writeHeader(type, header) {
    if (type < 0 || type > 15) throw new Error(`Bottle type out of range: ${type}`);
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
    framedStream.on("data", (data) => this.push(data));
    inStream.pipe(framedStream);
    return framedStream.endPromise();
  }

  _flush(callback) {
    this._close();
    callback();
  }

  _close() {
    this.push(new Buffer([ BOTTLE_END ]));
  }
}


// Converts a Readable stream into a framed data stream with a 4Q bottle
// header/footer. Write buffers, read buffers. This is a convenience version
// of BottleWriter for the case (like a compression stream) where there will
// be exactly one nested bottle.
class LoneBottleWriter extends BottleWriter {
  constructor(type, header, options = {}) {
    if (options.objectModeRead == null) options.objectModeRead = false;
    if (options.objectModeWrite == null) options.objectModeWrite = false;
    super(type, header, options);
    // make a single framed stream that we channel
    this.framedStream = framed_stream.writableFramedStream();
    this.framedStream.on("data", (data) => this.push(data));
  }

  _transform(data, _, callback) {
    this.framedStream.write(data, _, callback);
  }

  _flush(callback) {
    this.framedStream.end()
    this.framedStream.on("end", () => {
      this._close();
      callback();
    });
  }
}


// read a bottle from a stream, returning a BottleReader object, which is
// a stream that provides sub-streams.
function readBottleFromStream(stream) {
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
  toolkit.promisify(stream);
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
      return { type, header: bottle_header.unpack(headerBuffer) };
    });
  });
}


// stream that reads an underlying (buffer) stream, pulls out the header and
// type, and generates data streams.
class BottleReader extends stream.Readable {
  constructor(type, header, stream) {
    super({ objectMode: true });
    this.type = type;
    this.header = header;
    this.stream = stream;
    this.lastPromise = Promise.resolve();
    toolkit.promisify(this);
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
    return this._nextStream();
  }

  _nextStream() {
    // must finish reading the last thing we generated, if any:
    return this.lastPromise.then(() => {
      return this._readDataStream();
    }).then((stream) => {
      if (!stream) return this.push(null);
      this.lastPromise = stream.endPromise();
      this.push(stream);
    }).catch((error) => {
      this.emit("error", error);
    });
  }

  _readDataStream() {
    return this.stream.readPromise(1).then((buffer) => {
      if (!buffer || buffer[0] == BOTTLE_END) return null;
      // put it back. it's part of a data stream!
      this.stream.unshift(buffer);
      return framed_stream.readableFramedStream(this.stream);
    });
  }
}


exports.BottleReader = BottleReader;
exports.BottleWriter = BottleWriter;
exports.LoneBottleWriter = LoneBottleWriter;
exports.MAGIC = MAGIC;
exports.readBottleFromStream = readBottleFromStream;
exports.TYPE_FILE = TYPE_FILE;
exports.TYPE_HASHED = TYPE_HASHED;
exports.TYPE_ENCRYPTED = TYPE_ENCRYPTED;
exports.TYPE_COMPRESSED = TYPE_COMPRESSED;
