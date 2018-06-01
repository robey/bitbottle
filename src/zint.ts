/*
 * methods for encoding ints as:
 * - packed: LSB, with buffer length passed out-of-band
 * - length: specialized variable-length encoding that favors powers of two
 */

export function encodePackedInt(n: number): Buffer {
  if (n < 0) throw new Error("Unsigned ints only, plz");
  const bytes = [];
  while (n > 0xff) {
    bytes.push(n & 0xff);
    // don't use >> here. js will truncate the number to a 32-bit int.
    n = Math.floor(n / 256);
  }
  bytes.push(n & 0xff);
  return Buffer.from(bytes);
}

export function decodePackedInt(data: Buffer): number {
  return [...data].map((byte, i) => Math.pow(256, i) * byte).reduce((a, b) => a + b);
}

/*
 * - `0xxxxxxx` - 7 bits, 0 - 128
 * - `10xxxxxx xxxxxxxx` - 14 bits, 0 - 16KB
 * - `110xxxxx xxxxxxxx xxxxxxxx` - 21 bits, 0 - 2MB
 * - `1110xxxx` (e0 - ee) - 2**(7 + x) = 128 - 2MB
 */

export function encodeLength(n: number) {
  if (n <= Math.pow(2, 21) && n >= 128) {
    const log = logBase2(n);
    if (log !== undefined) return Buffer.from([ 0xe0 + log - 7 ]);
  }
  if (n < 128) return Buffer.from([ n ]);
  if (n < 16384) return new Buffer([ 0x80 + (n & 0x3f), (n >> 6) & 0xff ]);
  return Buffer.from([ 0xc0 + (n & 0x1f), (n >> 5) & 0xff, (n >> 13) & 0xff ]);
}

/*
 * Determine how many bytes will be needed to get the full length.
 */
export function lengthLength(byte: number): number {
  if ((byte & 0xf0) == 0xe0 || (byte & 0x80) == 0) return 1;
  if ((byte & 0xc0) == 0x80) return 2;
  if ((byte & 0xe0) == 0xc0) return 3;
  throw new Error("not a length");
}

/*
 * Use `lengthLength` on the first byte to ensure that you have as many bytes
 * as you need.
 */
export function decodeLength(data: Buffer) {
  if ((data[0] & 0x80) == 0) return data[0];
  if ((data[0] & 0xf0) == 0xe0) return Math.pow(2, 7 + (data[0] & 0xf));

  if ((data[0] & 0xc0) == 0x80) {
    return (data[0] & 0x3f) + (data[1] << 6);
  }

  if ((data[0] & 0xe0) == 0xc0) {
    return (data[0] & 0x3f) + (data[1] << 5) + (data[2] << 13);
  }

  throw new Error("not a length");
}

// hacker's delight! (returns undefined if not an exact power of 2)
function logBase2(n: number): number | undefined {
  let x = n - 1;
  if ((n & x) != 0) return undefined;
  x -= ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0F0F0F0F;
  x += (x << 8);
  x += (x << 16);
  x >>= 24;
  return x;
}
