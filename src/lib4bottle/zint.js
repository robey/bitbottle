"use strict";

/*
 * methods for encoding ints as:
 * - packed: LSB, with buffer length passed out-of-band
 * - length: specialized variable-length encoding that favors powers of two
 */

export function encodePackedInt(number) {
  if (number < 0) throw new Error("Unsigned ints only, plz");
  const bytes = [];
  while (number > 0xff) {
    bytes.push(number & 0xff);
    // don't use >> here. js will truncate the number to a 32-bit int.
    number /= 256;
  }
  bytes.push(number & 0xff);
  return new Buffer(bytes);
}

export function decodePackedInt(buffer) {
  let rv = 0;
  let multiplier = 1;

  for (let i = 0; i < buffer.length; i++) {
    rv += (buffer[i] & 0xff) * multiplier;
    multiplier *= 256;
  }
  return rv;
}

/*
 * 00000000 - end of stream
 * 0xxxxxxx - 1 thru 2^7 = 128
 * 10xxxxxx - (+ 1 byte, LSB) = 2^14 = 8K
 * 110xxxxx - (+ 2 byte, LSB) = 2^21 = 2M
 * 1110xxxx - (+ 3 byte, LSB) = 2^28 = 128M
 * 1111xxxx - 2^(7+x) = any power-of-2 block size from 128 to 2^21 = 2M
 * 11111111 - end of all streams
 */
export function encodeLength(n) {
  if (n < 128) return new Buffer([ n ]);
  if (n <= Math.pow(2, 22) && (n & (n - 1)) == 0) return new Buffer([ 0xf0 + logBase2(n) - 7 ]);
  if (n < 8192) return new Buffer([ 0x80 + (n & 0x3f), (n >> 6) & 0xff ]);
  if (n < Math.pow(2, 21)) return new Buffer([ 0xc0 + (n & 0x1f), (n >> 5) & 0xff, (n >> 13) & 0xff ]);
  if (n < Math.pow(2, 28)) return new Buffer([ 0xe0 + (n & 0xf), (n >> 4) & 0xff, (n >> 12) & 0xff, (n >> 20) & 0xff ]);
  throw new Error(`>:-P -> ${n}`);
}

export function readLength(stream) {
  return stream.readPromise(1).then(prefix => {
    if (prefix == null || prefix[0] == 0) return null;
    if ((prefix[0] & 0x80) == 0) return prefix[0];
    if ((prefix[0] & 0xf0) == 0xf0) return Math.pow(2, 7 + (prefix[0] & 0xf));
    if ((prefix[0] & 0xc0) == 0x80) {
      return stream.readPromise(1).then(data => {
        if (data == null) return null;
        return (prefix[0] & 0x3f) + (data[0] << 6);
      });
    }
    if ((prefix[0] & 0xe0) == 0xc0) {
      return stream.readPromise(2).then(data => {
        if (data == null) return null;
        return (prefix[0] & 0x3f) + (data[0] << 5) + (data[1] << 13);
      });
    }
    if ((prefix[0] & 0xf0) == 0xe0) {
      return stream.readPromise(3).then(data => {
        if (data == null) return null;
        return (prefix[0] & 0xf) + (data[0] << 4) + (data[1] << 12) + (data[2] << 20);
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
