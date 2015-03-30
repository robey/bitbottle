const stream = require("stream");
const toolkit = require("stream-toolkit");
const util = require("util");
const zint = require("./zint");

const DEFAULT_BLOCK_SIZE = Math.pow(2, 20);  // 1MB


// transform that buffers data until it reaches a desired block size, then
// adds a framing header for the block.
class WritableFramedStream extends stream.Transform {
  constructor(options = {}) {
    super(options);
    this.blockSize = options.blockSize || DEFAULT_BLOCK_SIZE;
    this.buffer = [];
    this.bufferSize = 0;
  }

  _transform(data, _, callback) {
    this.buffer.push(data);
    this.bufferSize += data.length;
    if (this.bufferSize >= this.blockSize) {
      this._drain(callback);
    } else {
      callback();
    }
  }

  _flush(callback) {
    this._drain(() => {
      this.push(new Buffer([ 0 ]));
      callback();
    });
  }

  _drain(callback) {
    if (this.bufferSize == 0) return callback();
    // hook: let the caller do a final transform on the buffers before we calculate the length.
    if (this.innerTransform) {
      this.innerTransform(this.buffer, (buffers) => {
        this.buffer = buffers;
        this.bufferSize = 0;
        for (b of buffers) this.bufferSize += b.length;
        this.__drain(callback);
      });
    } else {
      this.__drain(callback);
    }
  }

  __drain(callback) {
    this.push(encodeLength(this.bufferSize));
    this.buffer.map((d) => this.push(d));
    this.buffer = [];
    this.bufferSize = 0;
    callback();
  }
}


// wrap a framed stream into a Readable that provides the framed data.
class ReadableFramedStream extends stream.Readable {
  constructor(stream) {
    super();
    this.stream = stream;
    toolkit.promisify(this.stream);
  }

  _read(bytes) {
    return readLength(this.stream).then((length) => {
      if (length == null || length == 0) return this.push(null);
      this.stream.readPromise(length).then((data) => {
        this.push(data);
      });
    });
  }
}


// 0xxxxxxx - 0 thru 2^7 = 128 (0 = end of stream)
// 10xxxxxx - (+ 1 byte) = 2^14 = 8K
// 110xxxxx - (+ 2 byte) = 2^21 = 2M
// 1110xxxx - (+ 3 byte) = 2^28 = 128M
// 1111xxxx - 2^(7+x) = any power-of-2 block size from 128 to 2^22 = 4M
function encodeLength(n) {
  if (n < 128) return new Buffer([ n ]);
  if (n <= Math.pow(2, 22) && (n & (n - 1)) == 0) return new Buffer([ 0xf0 + logBase2(n) - 7 ]);
  if (n < 8192) return new Buffer([ 0x80 + (n & 0x3f), (n >> 6) & 0xff ]);
  if (n < Math.pow(2, 21)) return new Buffer([ 0xc0 + (n & 0x1f), (n >> 5) & 0xff, (n >> 13) & 0xff ]);
  if (n < Math.pow(2, 28)) return new Buffer([ 0xe0 + (n & 0xf), (n >> 4) & 0xff, (n >> 12) & 0xff, (n >> 20) & 0xff ]);
  throw new Error(`>:-P -> ${n}`);
}

function readLength(stream) {
  return stream.readPromise(1).then((prefix) => {
    if (prefix == null || prefix[0] == 0) return null;
    if ((prefix[0] & 0x80) == 0) return prefix[0];
    if ((prefix[0] & 0xf0) == 0xf0) return Math.pow(2, 7 + (prefix[0] & 0xf));
    if ((prefix[0] & 0xc0) == 0x80) {
      return stream.readPromise(1).then((data) => {
        if (data == null) return null;
        return (prefix[0] & 0x3f) + (data[0] << 6);
      });
    }
    if ((prefix[0] & 0xe0) == 0xc0) {
      return stream.readPromise(2).then((data) => {
        if (data == null) return null;
        return (prefix[0] & 0x3f) + (data[0] << 5) + (data[1] << 13);
      });
    }
    if ((prefix[0] & 0xf0) == 0xe0) {
      return stream.readPromise(3).then((data) => {
        if (data == null) return null;
        return (prefix[0] & 0xf) + (data[0] << 4) + (data[1] << 12) + (data[2] << 20)
      });
    }
    return null;
  });
}

// hacker's delight! (only works on exact powers of 2)
function logBase2(x) {
  x -= 1;
  x -= ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0F0F0F0F;
  x += (x << 8);
  x += (x << 16);
  x >>= 24;
  return x;
}


function readableFramedStream(stream) {
  return toolkit.promisify(new ReadableFramedStream(stream));
}

function writableFramedStream(stream) {
  return toolkit.promisify(new WritableFramedStream(stream));
}


exports.readableFramedStream = readableFramedStream;
exports.writableFramedStream = writableFramedStream;
