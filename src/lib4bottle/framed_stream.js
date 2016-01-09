"use strict";

import stream from "stream";
import { promisify, PullTransform } from "stream-toolkit";
import { decodeLength, encodeLength, lengthLength } from "./zint";

const END_OF_STREAM = new Buffer([ 0 ]);

/*
 * Stream transform that prefixes each buffer with a length header so it can
 * be streamed. If you want to create large frames, pipe through a
 * bufferingStream first.
 */
export function framingStream() {
  const transform = new stream.Transform({ name: "framingStream" });

  transform._transform = (data, _, callback) => {
    transform.push(encodeLength(data.length));
    transform.push(data);
    callback();
  };

  transform._flush = (callback) => {
    transform.push(END_OF_STREAM);
    callback();
  };

  return promisify(transform, { name: "framingStream" });
}

/*
 * Stream transform that unpacks frames back into data blocks.
 */
export function unframingStream() {
  const readLength = t => {
    return t.get(1).then(byte => {
      if (byte == null || byte.length < 1) return null;
      const needed = lengthLength(byte[0]) - 1;
      if (needed == 0) return decodeLength(byte);

      return t.get(needed).then(rest => {
        if (rest == null || rest.length < needed) return null;
        return decodeLength(Buffer.concat([ byte, rest ]));
      });
    });
  };

  const transform = new PullTransform({
    name: "unframingStream",
    transform: t => {
      return readLength(t).then(length => {
        if (length == null || length <= 0) {
          t.push(null);
          return;
        }
        return t.get(length);
      });
    }
  });

  return promisify(transform, { name: "unframingStream" });
}
