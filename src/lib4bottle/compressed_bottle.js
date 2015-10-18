"use strict";

import snappy from "snappy";
import { promisify, Transform, weld } from "stream-toolkit";
import xz from "xz";
import { Header, TYPE_ZINT } from "./bottle_header";
import { bottleWriter, TYPE_COMPRESSED } from "./bottle_stream";
import bufferingStream from "./buffering_stream";

const FIELDS = {
  NUMBERS: {
    COMPRESSION_TYPE: 0
  }
};

export const COMPRESSION_LZMA2 = 0;
export const COMPRESSION_SNAPPY = 1;

const COMPRESSION_NAMES = {
  [COMPRESSION_LZMA2]: "LZMA2",
  [COMPRESSION_SNAPPY]: "Snappy"
};

const LZMA_PRESET = 9;


export function compressedBottleWriter(compressionType) {
  const compressor = compressionTransformForType(compressionType);

  const header = new Header();
  header.addNumber(FIELDS.NUMBERS.COMPRESSION_TYPE, compressionType);
  const bottle = bottleWriter(TYPE_COMPRESSED, header);
  bottle.write(compressor);
  bottle.end();

  return { compressor, bottle };
}

export function compressedBottleReader(header, bottleReader) {
  const compressionHeader = decodeCompressionHeader(header);
  const zstream = decompressionTransformForType(compressionHeader.compressionType);
  return bottleReader.readPromise().then(stream => {
    stream.pipe(zstream);
    return zstream;
  });
}

export function decodeCompressionHeader(h) {
  const rv = {};
  h.fields.forEach(field => {
    switch (field.type) {
      case TYPE_ZINT:
        switch (field.id) {
          case FIELDS.NUMBERS.COMPRESSION_TYPE:
            rv.compressionType = field.number;
            break;
        }
    }
  });
  if (!rv.compressionType) rv.compressionType = COMPRESSION_LZMA2;
  rv.compressionName = COMPRESSION_NAMES[rv.compressionType];
  return rv;
}

function compressionTransformForType(compressionType) {
  switch (compressionType) {
    case COMPRESSION_SNAPPY:
      // snappy compression has no buffering or framing of its own, so we
      // need to add an explicit buffering layer.
      const transform = new Transform({
        name: "snappy-compress",
        transform: data => {
          return new Promise((resolve, reject) => {
            snappy.compress(data, (error, compressed) => {
              if (error) return reject(error);
              resolve(compressed);
            });
          });
        }
      });
      return weld(bufferingStream(), transform);
    case COMPRESSION_LZMA2:
      return promisify(new xz.Compressor(LZMA_PRESET), { name: "lzma2-compress" });
    default:
      throw new Error(`Unknown compression transform: ${compressionType}`);
  }
}

function decompressionTransformForType(compressionType) {
  switch (compressionType) {
    case COMPRESSION_SNAPPY:
      return new Transform({
        name: "snappy-decompress",
        transform: data => {
          return new Promise((resolve, reject) => {
            snappy.uncompress(data, { asBuffer: true }, (error, uncompressed) => {
              if (error) return reject(error);
              resolve(uncompressed);
            });
          });
        }
      });
    case COMPRESSION_LZMA2:
      return promisify(new xz.Decompressor(), { name: "lzma2-decompress" });
    default:
      throw new Error(`Unknown decompression transform: ${compressionType}`);
  }
}
