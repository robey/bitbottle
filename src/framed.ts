import { Stream } from "ballvalve";
import { debug, nameOf } from "./debug";
import { Readable } from "./readable";
import { decodeLength, encodeLength, lengthLength } from "./zint";

const END_OF_STREAM = Buffer.from([ 0 ]);

/*
 * Prefix each buffer with a length header so it can be streamed. If you want
 * to create large frames, pipe through `buffered` first.
 */
export async function* framed(stream: Stream): Stream {
  debug(`framed(${nameOf(stream)}) begin`);
  for await (const data of stream) {
    debug(`framed(${nameOf(stream)}): ${data.length}`);
    yield encodeLength(data.length);
    yield data;
  }
  yield END_OF_STREAM;
  debug(`framed(${nameOf(stream)}) end`);
}

/*
 * Unpack frames back into data blocks.
 */
export async function* unframed(stream: Readable): Stream {
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
