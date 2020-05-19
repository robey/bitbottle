import { asyncIter, ExtendedReadableStream, Stream } from "ballvalve";

const DEFAULT_BLOCK_SIZE = Math.pow(2, 20);  // 1MB

/*
 * buffer stream data to emit blocks of a specific size.
 * the last block may be smaller.
 */
export async function* buffered(stream: Stream, blockSize: number = DEFAULT_BLOCK_SIZE): Stream {
  let queue: Buffer[] = [];
  let size = 0;

  for await (const data of asyncIter(stream)) {
    queue.push(data);
    size += data.length;

    while (size >= blockSize) {
      let rv = Buffer.concat(queue, size);
      queue = [ rv.slice(blockSize) ];
      size = queue[0].length;
      yield rv.slice(0, blockSize);
    }
  }

  if (size > 0) yield Buffer.concat(queue, size);
}

/*
 * buffer a stream and add framing bytes of the form YYXXXXXX:  a 6-bit
 * int X, shifted left Y * 6 times. according to legend, only the final
 * frame may have Y = 0.
 */
export async function* framed(stream: Stream, blockSize?: number): Stream {
  let sentZero = false;

  if ((blockSize ?? DEFAULT_BLOCK_SIZE) < 64) throw new Error("Try harder, Homer");

  for await (let data of asyncIter(buffered(stream, blockSize))) {
    if (data.length >= 0x1000000) {
      throw new Error("Frames must be smaller than 16MB");
    }

    for (const y of [ 3, 2, 1, 0 ]) {
      if (data.length >= (1 << (y * 6))) {
        // 256K/4K/64/1 frame
        const scale = y * 6;
        const span = data.length >> scale;
        const len = span << scale;
        const frame = data.slice(0, len);
        data = data.slice(len);
        yield Buffer.from([ (y << 6) | span ]);
        yield frame;
        if (y == 0) sentZero = true;
      }
    }
  }

  // must be a final Y = 0 frame to indicate the end of the stream.
  if (!sentZero) yield Buffer.from([ 0 ]);
}

/*
 * unpack a stream of frames back into data. the stream end is detected by
 * having a final frame with Y = 0.
 */
export async function* unframed(stream: ExtendedReadableStream): Stream {
  while (true) {
    const frameLen = await stream.readExact(1);
    if (frameLen === undefined) throw new Error("Truncated stream (missing frame)");
    const len = (frameLen[0] & 0x3f) << (((frameLen[0] & 0xc0) >> 6) * 6);
    if (len > 0) {
      const data = await stream.readExact(len);
      if (data === undefined) throw new Error("Truncated stream");
      yield data;
    }
    if ((frameLen[0] & 0xc0) == 0) return;
  }
}
