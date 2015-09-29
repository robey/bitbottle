"use strict";

import stream from "stream";
import toolkit from "stream-toolkit";

const DEFAULT_BLOCK_SIZE = Math.pow(2, 20);  // 1MB

/*
 * Stream transform that buffers data until it reaches a desired block size,
 * then emits a single block.
 *
 * options:
 * - blockSize: default is 1MB
 * - exact: (boolean) slice blocks so that when at least `blockSize` bytes
 *   are available, emit a block of _exactly_ `blockSize` bytes (default:
 *   false)
 */
export default function bufferingStream(options = {}) {
  const blockSize = options.blockSize || DEFAULT_BLOCK_SIZE;
  const exact = options.exact;

  const transform = new stream.Transform();

  let queue = [];
  let size = 0;

  const drain = () => {
    if (size == 0) return;
    const buffer = Buffer.concat(queue, size);
    queue = [];
    size = 0;

    if (exact && buffer.length > blockSize) {
      const sliced = buffer.slice(0, blockSize);
      queue.push(buffer.slice(blockSize));
      size = queue[0].length;
      transform.push(sliced);
      if (size >= blockSize) drain();
    } else {
      transform.push(buffer);
    }
  };

  transform._transform = (data, _, callback) => {
    queue.push(data);
    size += data.length;
    if (size >= blockSize) drain();
    callback();
  };

  transform._flush = callback => {
    drain();
    callback();
  };

  return toolkit.promisify(transform, { name: "bufferingStream(" + blockSize + ")" });
}
