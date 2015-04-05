const bottle_stream = require("../../lib/4q/lib4q/bottle_stream");
const file_bottle = require("../../lib/4q/lib4q/file_bottle");
const hash_bottle = require("../../lib/4q/lib4q/hash_bottle");
const mocha_sprinkles = require("mocha-sprinkles");
const Promise = require("bluebird");
const toolkit = require("stream-toolkit");
const util = require("util");

const future = mocha_sprinkles.future;

function writeTinyFile(filename, data) {
  return toolkit.sourceStream(data).pipe(new file_bottle.FileBottleWriter({ filename: filename, size: data.length }));
}

function readTinyFile(bottle, filename) {
  return bottle.readPromise().then((fileStream) => {
    return bottle_stream.readBottleFromStream(fileStream).then((fileBottle) => {
      fileBottle.type.should.eql(bottle_stream.TYPE_FILE);
      fileBottle.header.filename.should.eql(filename);
      return fileBottle.readPromise().then((dataStream) => {
        return toolkit.pipeToBuffer(dataStream).then((buffer) => {
          return fileBottle.readPromise().then((nextBuffer) => {
            (nextBuffer == null).should.eql(true);
            return fileBottle.endPromise();
          }).then(() => {
            return fileStream.readPromise(1).then((empty) => {
              (empty == null).should.eql(true);
              return fileStream.endPromise();
            }).then(() => {
              return { header: fileBottle.header, data: buffer };
            });
          });
        });
      });
    });
  });
}


describe("HashBottleWriter", () => {
  it("writes and hashes a file stream", future(() => {
    const file = writeTinyFile("file.txt", new Buffer("the new pornographers"));
    return toolkit.pipeToBuffer(file).then((fileBuffer) => {
      // quick verification that we're hashing what we think we are.
      fileBuffer.toString("hex").should.eql(
        "f09f8dbc0000000d000866696c652e74787480011515746865206e657720706f726e6f677261706865727300ff"
      );
      const hashStream = new hash_bottle.HashBottleWriter(hash_bottle.HASH_SHA512);
      toolkit.sourceStream(fileBuffer).pipe(hashStream);
      return toolkit.pipeToBuffer(hashStream).then((buffer) => {
        // now decode it.
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      });
    }).then((bottle) => {
      bottle.type.should.eql(bottle_stream.TYPE_HASHED);
      bottle.header.hashType.should.eql(hash_bottle.HASH_SHA512);
      bottle.typeName().should.eql("hashed/SHA-512");
      return readTinyFile(bottle, "file.txt").then((file) => {
        file.data.toString().should.eql("the new pornographers");
      }).then(() => {
        return bottle.readPromise().then((hashStream) => {
          return toolkit.pipeToBuffer(hashStream).then((buffer) => {
            buffer.toString("hex").should.eql(
              "872613ed7e437f332b77ae992925ea33a4565e3f26c9d623da6c78aea9522d90261c4f52824b64f5ad4fdd020a4678c47bf862f53f02a62183749a1e0616b940"
            );
          });
        });
      });
    });
  }));
});

describe("HashBottleReader", () => {
  it("reads a hashed stream", future(() => {
    const hashStream = new hash_bottle.HashBottleWriter(hash_bottle.HASH_SHA512);
    writeTinyFile("file.txt", new Buffer("the new pornographers")).pipe(hashStream);
    return toolkit.pipeToBuffer(hashStream).then((buffer) => {
      // now decode it.
      return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
    }).then((bottle) => {
      bottle.type.should.eql(bottle_stream.TYPE_HASHED);
      bottle.header.hashType.should.eql(hash_bottle.HASH_SHA512);
      return bottle.validate().then(({ bottle, valid }) => {
        bottle.header.filename.should.eql("file.txt");
        return bottle.readPromise().then((dataStream) => {
          return toolkit.pipeToBuffer(dataStream).then((data) => {
            data.toString().should.eql("the new pornographers");
          });
        }).then(() => {
          return bottle.readPromise().then((dataStream) => {
            (dataStream == null).should.eql(true);
          });
        }).then(() => {
          return valid.then((valid) => {
            valid.should.eql(true);
          });
        });
      });
    });
  }));
});
