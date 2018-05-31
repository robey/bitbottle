"use strict";

import { bufferStream, compoundStream, PullTransform, sourceStream, Transform, weld } from "stream-toolkit";
import { packHeader, unpackHeader } from "./bottle_header";
import { framingStream, unframingStream } from "./framed_stream";

export const MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ]);
export const VERSION = 0x00;

export const TYPE_FILE = 0;
export const TYPE_HASHED = 1;
export const TYPE_ENCRYPTED = 3;
export const TYPE_COMPRESSED = 4;

const MIN_BUFFER = 1024;
const STREAM_BUFFER_SIZE = 256 * 1024;

export function bottleTypeName(n) {
  switch (n) {
    case TYPE_FILE: return "file";
    case TYPE_HASHED: return "hashed";
    case TYPE_ENCRYPTED: return "encrypted";
    case TYPE_COMPRESSED: return "compressed";
    default: return n.toString();
  }
}

const BOTTLE_END = 0xff;

/*
 * Stream transform that accepts child streams and emits them as a single
 * bottle stream with a header.
 */
export function writeBottle(type, header, options = {}) {
  const streamOptions = {
    name: "bottleWriterGuts",
    writableObjectMode: true,
    readableObjectMode: true,
    highWaterMark: STREAM_BUFFER_SIZE,
    transform: inStream => {
      // prevent tiny packets by requiring it to buffer at least 1KB
      const buffered = bufferStream(MIN_BUFFER);
      const framedStream = framingStream();
      transform.__log("writing stream " + (inStream.__name || "?") + " into " + framedStream.__name);
      inStream.pipe(buffered);
      buffered.pipe(framedStream);
      return framedStream;
    },
    flush: () => {
      transform.__log("flush: end of bottle");
      return sourceStream(new Buffer([ BOTTLE_END ]));
    }
  };
  for (const k in options) streamOptions[k] = options[k];

  const transform = new Transform(streamOptions);
  transform.push(sourceStream(writeHeader(type, header)));
  const outStream = compoundStream();
  return weld(transform, outStream, {
    name: `BottleWriter(${bottleTypeName(type)}, ${options.tag || ""})`,
    writableObjectMode: true
  });
}

function writeHeader(type, header) {
  if (type < 0 || type > 15) throw new Error(`Bottle type out of range: ${type}`);
  const buffer = packHeader(header);
  if (buffer.length > 4095) throw new Error(`Header too long: ${buffer.length} > 4095`);
  return Buffer.concat([
    MAGIC,
    new Buffer([
      VERSION,
      0,
      (type << 4) | ((buffer.length >> 8) & 0xf),
      (buffer.length & 0xff)
    ]),
    buffer
  ]);
}

/*
 * Stream transform that accepts a byte stream and emits a header, then one
 * or more child streams.
 */
export function readBottle(options = {}) {
  const streamOptions = {
    readableObjectMode: true,
    highWaterMark: STREAM_BUFFER_SIZE,
    transform: t => {
      return readHeader(t).then(header => {
        t.push(header);
        return next(t);
      });
    }
  };
  for (const k in options) streamOptions[k] = options[k];
  return new PullTransform(streamOptions);

  function next(t) {
    return t.get(1).then(byte => {
      if (!byte || byte[0] == BOTTLE_END) {
        t.push(null);
        return;
      }
      // put it back. it's part of a data stream!
      t.unget(byte);

      // unframe and emit.
      const unframing = unframingStream();
      t.subpipe(unframing);
      t.push(unframing);
      return unframing.endPromise().then(() => next(t));
    });
  }
}

function readHeader(transform) {
  transform.__log("readBottleHeader");
  return transform.get(8).then(buffer => {
    if (!buffer || buffer.length < 8) throw new Error("End of stream");
    for (let i = 0; i < 4; i++) {
      if (buffer[i] != MAGIC[i]) throw new Error("Incorrect magic (not a 4bottle archive)");
    }
    if (buffer[4] != VERSION) throw new Error(`Incompatible version: ${buffer[4].toString(16)}`);
    if (buffer[5] != 0) throw new Error(`Incompatible flags: ${buffer[5].toString(16)}`);
    const type = (buffer[6] >> 4) & 0xf;
    const headerLength = ((buffer[6] & 0xf) * 256) + (buffer[7] & 0xff);
    return transform.get(headerLength).then(headerBuffer => {
      const rv = { type, header: unpackHeader(headerBuffer || new Buffer(0)) };
      if (transform.__debug) transform.__log("readBottleHeader -> " + type + ", " + rv.header.toString());
      return rv;
    });
  });
}
