"use strict";

import toolkit from "stream-toolkit";
import { future } from "mocha-sprinkles";
import { validateFile, writeFile } from "./files";
import * as bottle_stream from "../../lib/lib4q/bottle_stream";
import * as compressed_bottle from "../../lib/lib4q/compressed_bottle";

import "should";
import "source-map-support/register";

describe("CompressedBottleWriter", () => {
  it("compresses a file stream with lzma2", future(() => {
    return writeFile("file.txt").then((fileBuffer) => {
      const x = new compressed_bottle.CompressedBottleWriter(compressed_bottle.COMPRESSION_LZMA2);
      toolkit.sourceStream(fileBuffer).pipe(x);
      return toolkit.pipeToBuffer(x).then((buffer) => {
        // now decode it.
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      });
    }).then((zbottle) => {
      zbottle.type.should.eql(bottle_stream.TYPE_COMPRESSED);
      zbottle.header.compressionType.should.eql(compressed_bottle.COMPRESSION_LZMA2);
      return zbottle.decompress().then((bottle) => {
        return validateFile(bottle, "file.txt");
      });
    });
  }));

  it("compresses a file stream with snappy", future(() => {
    return writeFile("file.txt").then((fileBuffer) => {
      const x = new compressed_bottle.CompressedBottleWriter(compressed_bottle.COMPRESSION_SNAPPY);
      toolkit.sourceStream(fileBuffer).pipe(x);
      return toolkit.pipeToBuffer(x).then((buffer) => {
        // now decode it.
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then((zbottle) => {
        zbottle.type.should.eql(bottle_stream.TYPE_COMPRESSED);
        zbottle.header.compressionType.should.eql(compressed_bottle.COMPRESSION_SNAPPY);
        return zbottle.decompress().then((bottle) => {
          return validateFile(bottle, "file.txt");
        });
      });
    });
  }));
});
