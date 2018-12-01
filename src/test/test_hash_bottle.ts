import { Decorate, Stream } from "ballvalve";
import { Bottle, BottleType } from "../bottle";
import { FileBottle } from "../file_bottle";
import { Hash, HashBottle, HashOptions } from "../hash_bottle";
import { Readable } from "../readable";

import "should";
import "source-map-support/register";

// pretend we signed it.
async function signer(data: Buffer): Promise<Buffer> {
  return Buffer.concat([ Buffer.from("sign"), data ]);
}

async function verifier(data: Buffer, signedBy: string): Promise<Buffer> {
  if (signedBy != "garfield") throw new Error("not garfield");
  if (data.slice(0, 4).toString() != "sign") throw new Error("not signed");
  return data.slice(4);
}

async function drain(s: Stream): Promise<Buffer> {
  return Buffer.concat(await Decorate.asyncIterator(s).collect());
}

function writeBottle(data: Buffer, options: HashOptions = {}): Promise<Buffer> {
  return drain(HashBottle.write(Hash.SHA512, Decorate.iterator([ data ]), options));
}

function readBottle(data: Buffer): Promise<Bottle> {
  return Bottle.read(new Readable(Decorate.iterator([ data ])));
}


describe("HashBottle", () => {
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

  it("verifies a small stream", async () => {
    const buffer = await writeBottle(Buffer.from("i choose you!"));

    const b = await readBottle(buffer);
    b.cap.type.should.eql(BottleType.Hashed);
    b.cap.header.toString().should.eql("Header(I0=0)");

    const hashBottle = await HashBottle.read(b);
    (await drain(hashBottle.stream)).toString().should.eql("i choose you!");
    const hash = await hashBottle.check();
    hash.toString("hex").should.eql(
      "d134df6f6314fca50918f8c2dea596a49bb723eb9ec156c21abe2c9d9803c614" +
      "86d07f8006c7428c780846209e9ffa6ed60dbf2a0408a109509c802545ee65b9"
    );
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
    const buffer = await writeBottle(Buffer.from("lasagna"), { signedBy: "garfield", signer });

    // now decode it.
    const bottle = await readBottle(buffer);
    bottle.cap.type.should.eql(BottleType.Hashed);
    bottle.cap.header.toString().should.eql("Header(I0=0, S0=garfield)");
    const hashBottle = await HashBottle.read(bottle);
    (await drain(hashBottle.stream)).toString().should.eql("lasagna");

    const hash = await hashBottle.check(verifier);
    hash.toString("hex").should.eql(
      "c6266ad3710a8f1981220ae89f7f4168b2407925c18af56e9a6086b88df44bfc" +
      "c906784332fb6ffd8a502185aa5b1b1d141d888156172dddbac56db4be02098a"
    );
  });

  it("rejects a badly signed hashed stream", async () => {
    const buffer = await writeBottle(Buffer.from("lasagna"), { signedBy: "odie", signer });

    // now decode it.
    const bottle = await readBottle(buffer);
    bottle.cap.type.should.eql(BottleType.Hashed);
    bottle.cap.header.toString().should.eql("Header(I0=0, S0=odie)");
    const hashBottle = await HashBottle.read(bottle);
    (await drain(hashBottle.stream)).toString().should.eql("lasagna");

    await hashBottle.check(verifier).should.be.rejectedWith(/not garfield/);
  });
});
