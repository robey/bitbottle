"use strict";

const bottle_stream = require("../../lib/4q/lib4q/bottle_stream");
const files = require("./files");
const file_bottle = require("../../lib/4q/lib4q/file_bottle");
const hash_bottle = require("../../lib/4q/lib4q/hash_bottle");
const mocha_sprinkles = require("mocha-sprinkles");
const Promise = require("bluebird");
const toolkit = require("stream-toolkit");
const util = require("util");

require("source-map-support").install();

const future = mocha_sprinkles.future;

describe("HashBottleWriter", () => {
  it("writes and hashes a file stream", future(() => {
    return files.writeFile("file.txt").then((fileBuffer) => {
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
      return files.readFile(bottle, "file.txt").then(() => {
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
    return files.writeFile("file.txt").then((fileBuffer) => {
      toolkit.sourceStream(fileBuffer).pipe(hashStream);
      return toolkit.pipeToBuffer(hashStream).then((buffer) => {
        // now decode it.
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      });
    }).then((bottle) => {
      bottle.type.should.eql(bottle_stream.TYPE_HASHED);
      bottle.header.hashType.should.eql(hash_bottle.HASH_SHA512);
      return bottle.validate().then(({ bottle, valid }) => {
        return files.validateFile(bottle, "file.txt").then(() => {
          return valid.then((valid) => {
            valid.should.eql(true);
          });
        });
      });
    });
  }));
});
