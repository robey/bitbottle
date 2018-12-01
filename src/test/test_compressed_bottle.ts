import { Decorate, Stream } from "ballvalve";
import { Bottle, BottleType } from "../bottle";
import { CompressedBottle, Compression } from "../compressed_bottle";
import { Readable } from "../readable";

import "should";
import "source-map-support/register";

async function drain(s: Stream): Promise<Buffer> {
  return Buffer.concat(await Decorate.asyncIterator(s).collect());
}

function writeBottle(compression: Compression, data: Buffer): Promise<Buffer> {
  return drain(CompressedBottle.write(compression, Decorate.iterator([ data ])));
}

function readBottle(data: Buffer): Promise<Bottle> {
  return Bottle.read(new Readable(Decorate.iterator([ data ])));
}

const TestString = "My cat's breath smells like cat food.";

describe("CompressedBottle", () => {
  it("compresses a stream with lzma2", async () => {
    const buffer = await writeBottle(Compression.LZMA2, Buffer.from(TestString));
    buffer.length.should.eql(106);

    const b = await readBottle(buffer);
    b.cap.type.should.eql(BottleType.Compressed);
    b.cap.header.toString().should.eql("Header(I0=0)");

    const c = await CompressedBottle.read(b);
    (await drain(c.stream)).toString().should.eql(TestString);
  });

  it("compresses a stream with snappy", async () => {
    const buffer = await writeBottle(Compression.SNAPPY, Buffer.from(TestString));
    buffer.length.should.eql(56);

    const b = await readBottle(buffer);
    b.cap.type.should.eql(BottleType.Compressed);
    b.cap.header.toString().should.eql("Header(I0=1)");

    const c = await CompressedBottle.read(b);
    (await drain(c.stream)).toString().should.eql(TestString);
  });
});
