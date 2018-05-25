import { Readable } from "./readable";
import { decodeLength, encodeLength, lengthLength } from "./zint";

const END_OF_STREAM = Buffer.from([ 0 ]);

/*
 * Prefix each buffer with a length header so it can be streamed. If you want
 * to create large frames, pipe through `buffered` first.
 */
export async function* framed(stream: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
  for await (const data of stream) {
    yield encodeLength(data.length);
    yield data;
  }
  yield END_OF_STREAM;
}

/*
 * Unpack frames back into data blocks.
 */
export async function* unframed(stream: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
  const s = new Readable(stream[Symbol.asyncIterator]());

  const readLength = async (): Promise<number | undefined> => {
    const byte = await s.read(1);
    if (byte === undefined || byte.length < 1) return undefined;
    const needed = lengthLength(byte[0]) - 1;
    if (needed == 0) return decodeLength(byte);

    const rest = await s.read(needed);
    if (rest === undefined || rest.length < needed) return undefined;
    return decodeLength(Buffer.concat([ byte, rest ]));
  };

  while (true) {
    const length = await readLength();
    if (length === undefined) throw new Error("Truncated stream");
    if (length == 0) return;
    const data = await s.read(length);
    if (data === undefined || data.length < length) throw new Error("Truncated stream");
    yield data;
  }
}
