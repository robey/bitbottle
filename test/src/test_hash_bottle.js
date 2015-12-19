"use strict";

import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { future } from "mocha-sprinkles";
import { bottleReader, TYPE_HASHED } from "../../lib/lib4bottle/bottle_stream";
import { readFile, writeFile } from "./files";
import { decodeHashHeader, hashBottleReader, hashBottleWriter, HASH_SHA512 } from "../../lib/lib4bottle/hash_bottle";

import "should";
import "source-map-support/register";

function signer(data) {
  return Promise.resolve(Buffer.concat([ new Buffer("sign"), data ]));
}

function verifier(data, signedBy) {
  if (signedBy != "garfield") return Promise.reject(new Error("not garfield"));
  if (data.slice(0, 4).toString() != "sign") return Promise.reject(new Error("not signed"));
  return Promise.resolve(data.slice(4));
}


describe("hashBottleWriter", () => {
  it("hashes a small stream", future(() => {
    return hashBottleWriter(HASH_SHA512).then(({ writer, bottle }) => {
      sourceStream("i choose you!").pipe(writer);
      return pipeToBuffer(bottle).then(buffer => {
        // now decode it.
        const reader = bottleReader();
        sourceStream(buffer).pipe(reader);
        return reader.readPromise().then(data => {
          data.type.should.eql(TYPE_HASHED);
          const header = decodeHashHeader(data.header);
          header.hashType.should.eql(HASH_SHA512);

          return hashBottleReader(header, reader);
        }).then(({ stream, hexPromise }) => {
          return pipeToBuffer(stream).then(buffer => {
            buffer.toString().should.eql("i choose you!");
            return hexPromise;
          });
        }).then(hex => {
          hex.should.eql(
            "d134df6f6314fca50918f8c2dea596a49bb723eb9ec156c21abe2c9d9803c614" +
            "86d07f8006c7428c780846209e9ffa6ed60dbf2a0408a109509c802545ee65b9"
          );
        });
      });
    });
  }));

  it("writes and hashes a file stream", future(() => {
    return writeFile("file.txt").then(fileBuffer => {
      return hashBottleWriter(HASH_SHA512).then(({ writer, bottle }) => {
        sourceStream(fileBuffer).pipe(writer);
        return pipeToBuffer(bottle).then(buffer => {
          // now decode it.
          const reader = bottleReader();
          sourceStream(buffer).pipe(reader);
          return reader.readPromise().then(data => {
            data.type.should.eql(TYPE_HASHED);
            const header = decodeHashHeader(data.header);
            header.hashType.should.eql(HASH_SHA512);

            return hashBottleReader(header, reader);
          }).then(({ stream, hexPromise }) => {
            return readFile(stream, "file.txt").then(() => {
              return hexPromise;
            });
          }).then(hex => {
            hex.should.eql(
              "872613ed7e437f332b77ae992925ea33a4565e3f26c9d623da6c78aea9522d90" +
              "261c4f52824b64f5ad4fdd020a4678c47bf862f53f02a62183749a1e0616b940"
            );
          });
        });
      });
    });
  }));

  it("signs a bottle", future(() => {
    return writeFile("file.txt").then(fileBuffer => {
      return hashBottleWriter(HASH_SHA512, { signedBy: "garfield", signer }).then(({ writer, bottle }) => {
        sourceStream(fileBuffer).pipe(writer);
        return pipeToBuffer(bottle).then(buffer => {
          // now decode it.
          const reader = bottleReader();
          sourceStream(buffer).pipe(reader);
          return reader.readPromise().then(data => {
            data.type.should.eql(TYPE_HASHED);
            const header = decodeHashHeader(data.header);
            header.hashType.should.eql(HASH_SHA512);
            header.signedBy.should.eql("garfield");

            return hashBottleReader(header, reader, { verifier });
          }).then(({ stream, hexPromise }) => {
            return readFile(stream, "file.txt").then(() => {
              return hexPromise;
            });
          }).then(hex => {
            hex.should.eql(
              "872613ed7e437f332b77ae992925ea33a4565e3f26c9d623da6c78aea9522d90" +
              "261c4f52824b64f5ad4fdd020a4678c47bf862f53f02a62183749a1e0616b940"
            );
          });
        });
      });
    });
  }));

  it("rejects a badly signed hashed stream", future(() => {
    return writeFile("file.txt").then(fileBuffer => {
      return hashBottleWriter(HASH_SHA512, { signedBy: "odie", signer }).then(({ writer, bottle }) => {
        sourceStream(fileBuffer).pipe(writer);
        return pipeToBuffer(bottle).then(buffer => {
          // now decode it.
          const reader = bottleReader();
          sourceStream(buffer).pipe(reader);
          return reader.readPromise().then(data => {
            return hashBottleReader(decodeHashHeader(data.header), reader, { verifier });
          }).then(({ stream, hexPromise }) => {
            return readFile(stream, "file.txt").then(() => {
              return hexPromise;
            });
          }).then(hex => {
            hex.should.eql("nothing good can be here");
          }, error => {
            error.message.should.match(/not garfield/);
          });
        });
      });
    });
  }));
});
