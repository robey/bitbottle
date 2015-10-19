"use strict";

import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { future } from "mocha-sprinkles";
import { bottleReader, TYPE_COMPRESSED } from "../../lib/lib4bottle/bottle_stream";
import {
  compressedBottleReader,
  compressedBottleWriter,
  COMPRESSION_LZMA2,
  COMPRESSION_SNAPPY,
  decodeCompressionHeader
} from "../../lib/lib4bottle/compressed_bottle";

import "should";
import "source-map-support/register";

const TestString = "My cat's breath smells like cat food.";

describe("compressedBottleWriter", () => {
  it("compresses a stream with lzma2", future(() => {
    const { compressor, bottle } = compressedBottleWriter(COMPRESSION_LZMA2);
    sourceStream(TestString).pipe(compressor);
    return pipeToBuffer(bottle).then(data => {
      // now decode it.
      const reader = bottleReader();
      sourceStream(data).pipe(reader);
      return reader.readPromise().then(data => {
        data.type.should.eql(TYPE_COMPRESSED);
        const header = decodeCompressionHeader(data.header);
        header.compressionType.should.eql(COMPRESSION_LZMA2);
        header.compressionName.should.eql("LZMA2");

        return compressedBottleReader(data.header, reader).then(decompressor => {
          return decompressor.readPromise().then(content => {
            content.toString().should.eql(TestString);
          });
        });
      });
    });
  }));

  it("compresses a stream with snappy", future(() => {
    const { compressor, bottle } = compressedBottleWriter(COMPRESSION_SNAPPY);
    compressor.write(TestString.slice(0, 20));
    compressor.write(TestString.slice(20));
    compressor.end();
    return pipeToBuffer(bottle).then(data => {
      // now decode it.
      const reader = bottleReader();
      sourceStream(data).pipe(reader);
      return reader.readPromise().then(data => {
        data.type.should.eql(TYPE_COMPRESSED);
        const header = decodeCompressionHeader(data.header);
        header.compressionType.should.eql(COMPRESSION_SNAPPY);
        header.compressionName.should.eql("Snappy");

        return compressedBottleReader(data.header, reader).then(decompressor => {
          return decompressor.readPromise().then(content => {
            content.toString().should.eql(TestString);
          });
        });
      });
    });
  }));
});
