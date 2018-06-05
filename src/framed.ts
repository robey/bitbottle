import { asyncIter, ExtendedAsyncIterator, Stream } from "ballvalve";
import { debug, nameOf } from "./debug";
import { Readable } from "./readable";
import { decodeLength, encodeLength, lengthLength } from "./zint";

const END_OF_STREAM = Buffer.from([ 0 ]);

/*
 * Prefix each buffer with a length header so it can be streamed. If you want
 * to create large frames, pipe through `buffered` first.
 */
export async function* _framed(stream: Stream): Stream {
  for await (const data of stream) {
    yield encodeLength(data.length);
    yield data;
  }
  yield END_OF_STREAM;
}

export function framed(stream: Stream): ExtendedAsyncIterator<Buffer> {
  return asyncIter(_framed(stream));
}

/*
 * Unpack frames back into data blocks.
 */
async function* _unframed(stream: Readable): Stream {
  const readLength = async (): Promise<number | undefined> => {
    const byte = await stream.read(1);
    if (byte === undefined || byte.length < 1) return undefined;
    const needed = lengthLength(byte[0]) - 1;
    if (needed == 0) return decodeLength(byte);

    const rest = await stream.read(needed);
    if (rest === undefined || rest.length < needed) return undefined;
    return decodeLength(Buffer.concat([ byte, rest ]));
  };

  while (true) {
    const length = await readLength();
    if (length === undefined) throw new Error("Truncated stream");
    if (length == 0) return;
    const data = await stream.read(length);
    if (data === undefined || data.length < length) throw new Error("Truncated stream");
    yield data;
  }
}

// take a Readable, pull out a new Readable, and when the new stream ends, push back the remainder.
export function unframed(stream: Readable): Readable {
  const iter = asyncIter(_unframed(stream));
  const r = new Readable(iter);
  iter.done.then(() => {
    const remainder = r.remainder();
    if (remainder) stream.unread(remainder);
  });
  return r;
}
