"use strict";

const bottle_header = require("./bottle_header");
const bottle_stream = require("./bottle_stream");
const snappy = require("snappy");
const stream = require("stream");
const toolkit = require("stream-toolkit");
const util = require("util");
const xz = require("xz");

const FIELDS = {
  NUMBERS: {
    COMPRESSION_TYPE: 0
  }
};

const COMPRESSION_LZMA2 = 0;
const COMPRESSION_SNAPPY = 1;

const COMPRESSION_NAMES = {
  [COMPRESSION_LZMA2]: "LZMA2",
  [COMPRESSION_SNAPPY]: "Snappy"
};

const LZMA_PRESET = 9;


function compressionStreamForType(compressionType) {
  switch (compressionType) {
    case COMPRESSION_LZMA2: return new xz.Compressor(LZMA_PRESET);
    default:
      throw new Error(`Unknown compression stream: ${compressionType}`);
  }
}

function compressionTransformForType(compressionType) {
  switch (compressionType) {
    case COMPRESSION_SNAPPY: return snappy.compress;
    default:
      throw new Error(`Unknown compression transform: ${compressionType}`);
  }
}

function decompressionStreamForType(compressionType) {
  switch (compressionType) {
    case COMPRESSION_LZMA2: return new xz.Decompressor();
    case COMPRESSION_SNAPPY: return new SnappyDecompressor();
    default:
      throw new Error(`Unknown compression type: ${compressionType}`);
  }
}


// Takes a Readable stream (usually a WritableBottleStream) and produces a new
// Readable stream containing the compressed bottle.
class CompressedBottleWriter extends bottle_stream.LoneBottleWriter {
  constructor(compressionType) {
    super(
      bottle_stream.TYPE_COMPRESSED,
      new bottle_header.Header().addNumber(FIELDS.NUMBERS.COMPRESSION_TYPE, compressionType),
      { objectModeRead: false, objectModeWrite: false }
    );
    this.compressionType = compressionType;
    // snappy compression has no framing of its own, so it needs to compress
    // each frame as a whole block of its own.
    //   this.usesFraming: -> framedStream (with inner compressor) ->
    //   otherwise: -> zStream -> framedStream ->
    this.usesFraming = false
    switch (this.compressionType) {
      case COMPRESSION_SNAPPY:
        this.usesFraming = true;
        break;
    }
    if (this.usesFraming) {
      const transform = compressionTransformForType(this.compressionType);
      toolkit.promisify(transform, { name: COMPRESSION_NAMES[this.compressionType] });
      this.framedStream.innerTransform = (buffers, callback) => {
        transform(Buffer.concat(buffers), (error, compressedData) => {
          if (error) return this.emit("error", error);
          callback([ compressedData ]);
        });
      };
    } else {
      this.zStream = compressionStreamForType(this.compressionType);
      toolkit.promisify(this.zStream, { name: COMPRESSION_NAMES[this.compressionType] });
      this._process(this.zStream);
    }
  }

  _transform(data, _, callback) {
    return (this.usesFraming ? this.framedStream : this.zStream).write(data, _, callback);
  }

  _flush(callback) {
    const s = this.usesFraming ? this.framedStream : this.zStream;
    s.end();
    s.on("end", () => {
      this._close();
      callback();
    });
  }
}


function decodeCompressedHeader(h) {
  const rv = {};
  h.fields.forEach((field) => {
    switch (field.type) {
      case bottle_header.TYPE_ZINT:
        switch (field.id) {
          case FIELDS.NUMBERS.COMPRESSION_TYPE:
            rv.compressionType = field.number;
            break;
        }
    }
  });
  if (!rv.compressionType) rv.compressionType = COMPRESSION_LZMA2;
  rv.compressionName = COMPRESSION_NAMES[rv.compressionType];
  return rv;
}

class CompressedBottleReader extends bottle_stream.BottleReader {
  constructor(header, stream) {
    super(bottle_stream.TYPE_COMPRESSED, header, stream);
  }

  typeName() {
    return `compressed/${COMPRESSION_NAMES[this.header.compressionType]}`;
  }

  decompress() {
    const zStream = decompressionStreamForType(this.header.compressionType);
    toolkit.promisify(zStream, { name: COMPRESSION_NAMES[this.compressionType] });
    return this.readPromise().then((compressedStream) => {
      compressedStream.pipe(zStream);
      return bottle_stream.readBottleFromStream(zStream);
    });
  }
}


// helpers for snappy: make it streamable for decompression.
// snappy only compresses small buffers at a time, and needs to piggy-back on our own framing.
class SnappyDecompressor extends stream.Transform {
  constructor(options) {
    super(options);
    toolkit.promisify(this, { name: "SnappyDecompressor" });
  }

  _transform(data, _, callback) {
    snappy.uncompress(data, { asBuffer: true }, (error, uncompressed) => {
      if (error) return this.emit("error", error);
      this.push(uncompressed);
      callback();
    });
  }
}


exports.COMPRESSION_LZMA2 = COMPRESSION_LZMA2;
exports.COMPRESSION_SNAPPY = COMPRESSION_SNAPPY;

exports.CompressedBottleReader = CompressedBottleReader;
exports.CompressedBottleWriter = CompressedBottleWriter;
exports.decodeCompressedHeader = decodeCompressedHeader;
