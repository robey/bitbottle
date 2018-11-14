import { Decorate, Stream } from "ballvalve";
import { Bottle, BottleType } from "../bottle";
import { FileBottle } from "../file_bottle";
import { Hash, HashBottle, HashOptions } from "../hash_bottle";
import { Readable } from "../readable";

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

function readBottle(data: Buffer): Promise<Bottle> {
  return Bottle.read(new Readable(Decorate.iterator([ data ])));
}


describe("hashBottleWriter", () => {
  it("hashes a small stream", async () => {
    const buffer = await writeBottle(Buffer.from("i choose you!"));

    const b = await readBottle(buffer);
    b.cap.type.should.eql(BottleType.Hashed);
    b.cap.header.toString().should.eql("Header(I0=0)");

    const s1 = await b.nextStream();
    (await drain(s1)).toString().should.eql("i choose you!");
    const s2 = await b.nextStream();
    (await drain(s2)).toString("hex").should.eql(
      "d134df6f6314fca50918f8c2dea596a49bb723eb9ec156c21abe2c9d9803c614" +
      "86d07f8006c7428c780846209e9ffa6ed60dbf2a0408a109509c802545ee65b9"
    );
    await b.assertEndOfStreams();
  });

  it("writes and hashes a file stream", async () => {
    const bottleStream = FileBottle.write(
      { filename: "file.txt", folder: false, size: 21 },
      Decorate.iterator([ Buffer.from("the new pornographers") ])
    );
    const hashed = HashBottle.write(Hash.SHA512, bottleStream);

    // now decode it.
    const bottle = await Bottle.read(new Readable(hashed));
    bottle.cap.type.should.eql(BottleType.Hashed);
    bottle.cap.header.toString().should.eql("Header(I0=0)");

    // first stream is a nested FileBottle
    const s1 = await bottle.nextStream();
    const fb = await Bottle.read(new Readable(s1));
    fb.cap.type.should.eql(BottleType.File);
    const file = await FileBottle.read(fb);
    file.meta.should.eql({ filename: "file.txt", folder: false, size: 21 });
    (await drain(file.stream)).toString().should.eql("the new pornographers");

    // second stream is the hash
    const s2 = await bottle.nextStream();
    (await drain(s2)).toString("hex").should.eql(
      "365a4cc0ef4b830ba70c242ca73f61341caf9cf83b114e273dd0a8668d4cdf46" +
      "dce475da8bed5e22a629d828323ebb679e167720aee0f93efe07f6ab3ad906be"
    );
    await bottle.assertEndOfStreams();
  });

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
