"use strict";

import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { future } from "mocha-sprinkles";
import { readBottle, TYPE_COMPRESSED } from "../../lib/lib4bottle/bottle_stream";
import {
  readCompressedBottle,
  writeCompressedBottle,
  COMPRESSION_LZMA2,
  COMPRESSION_SNAPPY,
  decodeCompressionHeader
} from "../../lib/lib4bottle/compressed_bottle";

import "should";
import "source-map-support/register";

const TestString = "My cat's breath smells like cat food.";

describe("compressedBottleWriter", () => {
  it("compresses a stream with lzma2", future(() => {
    return writeCompressedBottle(COMPRESSION_LZMA2).then(({ writer, bottle }) => {
      sourceStream(TestString).pipe(writer);
      return pipeToBuffer(bottle).then(data => {
        // now decode it.
        const reader = readBottle();
        sourceStream(data).pipe(reader);
        return reader.readPromise().then(data => {
          data.type.should.eql(TYPE_COMPRESSED);
          const header = decodeCompressionHeader(data.header);
          header.compressionType.should.eql(COMPRESSION_LZMA2);
          header.compressionName.should.eql("LZMA2");

          return readCompressedBottle(decodeCompressionHeader(data.header), reader).then(decompressor => {
            return decompressor.readPromise().then(content => {
              content.toString().should.eql(TestString);
            });
          });
        });
      });
    });
  }));

  it("compresses a stream with snappy", future(() => {
    return writeCompressedBottle(COMPRESSION_SNAPPY).then(({ writer, bottle}) => {
      writer.write(TestString.slice(0, 20));
      writer.write(TestString.slice(20));
      writer.end();
      return pipeToBuffer(bottle).then(data => {
        // now decode it.
        const reader = readBottle();
        sourceStream(data).pipe(reader);
        return reader.readPromise().then(data => {
          data.type.should.eql(TYPE_COMPRESSED);
          const header = decodeCompressionHeader(data.header);
          header.compressionType.should.eql(COMPRESSION_SNAPPY);
          header.compressionName.should.eql("Snappy");

          return readCompressedBottle(decodeCompressionHeader(data.header), reader).then(decompressor => {
            return decompressor.readPromise().then(content => {
              content.toString().should.eql(TestString);
            });
          });
        });
      });
    });
  }));
});
