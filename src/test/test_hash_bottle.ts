import { Decorate, Stream } from "ballvalve";
import { Bottle, BottleReader, BottleType } from "../bottle";
import { Hash, HashBottle, HashOptions } from "../hash_bottle";
import { Readable } from "../readable";

// import { pipeToBuffer, sourceStream } from "stream-toolkit";
// import { future } from "mocha-sprinkles";
// import { readBottle, TYPE_HASHED } from "../../lib/lib4bottle/bottle_stream";
// import { readFile, writeFile } from "./files";
// import { decodeHashHeader, readHashBottle, writeHashBottle, HASH_SHA512 } from "../../lib/lib4bottle/hash_bottle";

import "should";
import "source-map-support/register";

// pretend we signed it.
async function signer(data: Buffer): Promise<Buffer> {
  return Buffer.concat([ new Buffer("sign"), data ]);
}

// function verifier(data, signedBy) {
//   if (signedBy != "garfield") return Promise.reject(new Error("not garfield"));
//   if (data.slice(0, 4).toString() != "sign") return Promise.reject(new Error("not signed"));
//   return Promise.resolve(data.slice(4));
// }

async function drain(s: Stream): Promise<Buffer> {
  return Buffer.concat(await Decorate.asyncIterator(s).collect());
}

function writeBottle(data: Buffer, options: HashOptions = {}): Promise<Buffer> {
  return drain(HashBottle.write(Hash.SHA512, Decorate.iterator([ data ]), options));
}

function readBottle(data: Buffer): Promise<BottleReader> {
  return Bottle.read(new Readable(Decorate.iterator([ data ])));
}


describe("hashBottleWriter", () => {
  it("hashes a small stream", async () => {
    const buffer = await writeBottle(Buffer.from("i choose you!"));

    const b = await readBottle(buffer);
    b.cap.type.should.eql(BottleType.Hashed);
    b.cap.header.toString().should.eql("Header(I0=0)");

    const item = await b.next();
    item.done.should.eql(false);
    (await drain(item.value)).toString().should.eql("i choose you!");
    const item2 = await b.next();
    item2.done.should.eql(false);
    (await drain(item2.value)).toString("hex").should.eql(
      "d134df6f6314fca50918f8c2dea596a49bb723eb9ec156c21abe2c9d9803c614" +
      "86d07f8006c7428c780846209e9ffa6ed60dbf2a0408a109509c802545ee65b9"
    );
    (await b.next()).done.should.eql(true);
  });

  // it("writes and hashes a file stream", future(() => {
//     return writeFile("file.txt").then(fileBuffer => {
//       return writeHashBottle(HASH_SHA512).then(({ writer, bottle }) => {
//         sourceStream(fileBuffer).pipe(writer);
//         return pipeToBuffer(bottle).then(buffer => {
//           // now decode it.
//           const reader = readBottle();
//           sourceStream(buffer).pipe(reader);
//           return reader.readPromise().then(data => {
//             data.type.should.eql(TYPE_HASHED);
//             const header = decodeHashHeader(data.header);
//             header.hashType.should.eql(HASH_SHA512);

//             return readHashBottle(header, reader);
//           }).then(({ stream, hexPromise }) => {
//             return readFile(stream, "file.txt").then(() => {
//               return hexPromise;
//             });
//           }).then(hex => {
//             hex.should.eql(
//               "872613ed7e437f332b77ae992925ea33a4565e3f26c9d623da6c78aea9522d90" +
//               "261c4f52824b64f5ad4fdd020a4678c47bf862f53f02a62183749a1e0616b940"
//             );
//           });
//         });
//       });
//     });
//   }));

  it("signs a bottle", async () => {
    // const buffer = await writeHexBottle(Buffer.from("lasagna"), { signedBy: "garfield", signer });
    // const b = await readBottle(buffer);
    // b.bottle.type.should.eql(BottleType.Hashed);
    // b.bottle.header.toString().should.eql("Header(I0=0, S0=garfield)");

    // now decode it.
          // const reader = readBottle();
          // sourceStream(buffer).pipe(reader);
          // return reader.readPromise().then(data => {
          //   data.type.should.eql(TYPE_HASHED);
          //   const header = decodeHashHeader(data.header);
          //   header.hashType.should.eql(HASH_SHA512);
          //   header.signedBy.should.eql("garfield");

//             return readHashBottle(header, reader, { verifier });
//           }).then(({ stream, hexPromise }) => {
//             return readFile(stream, "file.txt").then(() => {
//               return hexPromise;
//             });
//           }).then(hex => {
//             hex.should.eql(
//               "872613ed7e437f332b77ae992925ea33a4565e3f26c9d623da6c78aea9522d90" +
//               "261c4f52824b64f5ad4fdd020a4678c47bf862f53f02a62183749a1e0616b940"
//             );
//           });
//         });
//       });
//     });
  });

//   it("rejects a badly signed hashed stream", future(() => {
//     return writeFile("file.txt").then(fileBuffer => {
//       return writeHashBottle(HASH_SHA512, { signedBy: "odie", signer }).then(({ writer, bottle }) => {
//         sourceStream(fileBuffer).pipe(writer);
//         return pipeToBuffer(bottle).then(buffer => {
//           // now decode it.
//           const reader = readBottle();
//           sourceStream(buffer).pipe(reader);
//           return reader.readPromise().then(data => {
//             return readHashBottle(decodeHashHeader(data.header), reader, { verifier });
//           }).then(({ stream, hexPromise }) => {
//             return readFile(stream, "file.txt").then(() => {
//               return hexPromise;
//             });
//           }).then(hex => {
//             hex.should.eql("nothing good can be here");
//           }, error => {
//             error.message.should.match(/not garfield/);
//           });
//         });
//       });
//     });
//   }));
});
