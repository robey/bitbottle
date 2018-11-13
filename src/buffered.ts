import { Decorate, Stream } from "ballvalve";

const DEFAULT_BLOCK_SIZE = Math.pow(2, 20);  // 1MB

/*
 * buffer data until it reaches a desired block size, then emit a single
 * block. if `exact` is set, emit blocks of _exactly_ `blockSize` instead of
 * preserving incoming block boundaries.
 */
export async function* buffered(
  stream: Stream,
  blockSize: number = DEFAULT_BLOCK_SIZE,
  exact: boolean = false
): Stream {
  let queue: Buffer[] = [];
  let size = 0;

  for await (const data of Decorate.asyncIterator(stream)) {
    queue.push(data);
    size += data.length;

    while (size >= blockSize) {
      let rv = Buffer.concat(queue, size);
      queue = [];
      size = 0;

      if (exact) {
        queue = [ rv.slice(blockSize) ];
        size = queue[0].length;
        rv = rv.slice(0, blockSize);
      }

      yield rv;
    }
  }

  if (size > 0) yield Buffer.concat(queue, size);
}
