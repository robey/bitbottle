"use strict";

const bottle_stream = require("../../lib/4q/lib4q/bottle_stream");
const compressed_bottle = require("../../lib/4q/lib4q/compressed_bottle");
const files = require("./files");
const mocha_sprinkles = require("mocha-sprinkles");
const toolkit = require("stream-toolkit");
const util = require("util");

require("source-map-support").install();

const future = mocha_sprinkles.future;

describe("CompressedBottleWriter", () => {
  it("compresses a file stream with lzma2", future(() => {
    return files.writeFile("file.txt").then((fileBuffer) => {
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
        return files.validateFile(bottle, "file.txt");
      });
    });
  }));

  it("compresses a file stream with snappy", future(() => {
    return files.writeFile("file.txt").then((fileBuffer) => {
      const x = new compressed_bottle.CompressedBottleWriter(compressed_bottle.COMPRESSION_SNAPPY);
      toolkit.sourceStream(fileBuffer).pipe(x);
      return toolkit.pipeToBuffer(x).then((buffer) => {
        // now decode it.
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then((zbottle) => {
        zbottle.type.should.eql(bottle_stream.TYPE_COMPRESSED);
        zbottle.header.compressionType.should.eql(compressed_bottle.COMPRESSION_SNAPPY);
        return zbottle.decompress().then((bottle) => {
          return files.validateFile(bottle, "file.txt");
        });
      });
    });
  }));
});
