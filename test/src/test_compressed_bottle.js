const bottle_stream = require("../../lib/4q/lib4q/bottle_stream");
const compressed_bottle = require("../../lib/4q/lib4q/compressed_bottle");
const file_bottle = require("../../lib/4q/lib4q/file_bottle");
const mocha_sprinkles = require("mocha-sprinkles");
const toolkit = require("stream-toolkit");
const util = require("util");

const future = mocha_sprinkles.future;

function writeTinyFile(filename, data) {
  return toolkit.sourceStream(data).pipe(new file_bottle.FileBottleWriter({ filename: filename, size: data.length }));
}

function validateTinyFile(fileBottle, filename) {
  fileBottle.type.should.eql(bottle_stream.TYPE_FILE);
  fileBottle.header.filename.should.eql(filename);
  return fileBottle.readPromise().then((dataStream) => {
    return toolkit.pipeToBuffer(dataStream).then((buffer) => {
      return { header: fileBottle.header, data: buffer };
    });
  });
}


describe("CompressedBottleWriter", () => {
  it("compresses a file stream with lzma2", future(() => {
    const file = writeTinyFile("file.txt", new Buffer("the new pornographers"));
    return toolkit.pipeToBuffer(file).then((fileBuffer) => {
      // quick verification that we're hashing what we think we are.
      fileBuffer.toString("hex").should.eql(
        "f09f8dbc0000000d000866696c652e74787480011515746865206e657720706f726e6f677261706865727300ff"
      );
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
        return validateTinyFile(bottle, "file.txt").then(({ header, data }) => {
          data.toString().should.eql("the new pornographers");
        });
      });
    });
  }));

  // FIXME refactor
  it("compresses a file stream with snappy", future(() => {
    const fileBottle = writeTinyFile("file.txt", new Buffer("the new pornographers"));
    const x = new compressed_bottle.CompressedBottleWriter(compressed_bottle.COMPRESSION_SNAPPY);
    fileBottle.pipe(x);
    return toolkit.pipeToBuffer(x).then((buffer) => {
      // now decode it.
      return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
    }).then((zbottle) => {
      zbottle.type.should.eql(bottle_stream.TYPE_COMPRESSED);
      zbottle.header.compressionType.should.eql(compressed_bottle.COMPRESSION_SNAPPY);
      return zbottle.decompress().then((bottle) => {
        return validateTinyFile(bottle, "file.txt").then(({ header, data }) => {
          data.toString().should.eql("the new pornographers");
        });
      });
    });
  }));
});
