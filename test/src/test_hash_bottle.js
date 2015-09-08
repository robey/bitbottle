"use strict";

import Promise from "bluebird";
import toolkit from "stream-toolkit";
import { future } from "mocha-sprinkles";
import * as bottle_stream from "../../lib/lib4bottle/bottle_stream";
import * as files from "./files";
import * as file_bottle from "../../lib/lib4bottle/file_bottle";
import * as hash_bottle from "../../lib/lib4bottle/hash_bottle";

import "should";
import "source-map-support/register";

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
