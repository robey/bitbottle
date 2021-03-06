import { byteReader } from "ballvalve";
import { asyncify, asyncOne } from "../async";
import { Bottle } from "../bottle";
import { BottleCap, BottleType } from "../bottle_cap";
import { Compression, readCompressedBottle, writeCompressedBottle } from "../compressed_bottle";
import { Header } from "../header";
import { drain, prngBytes } from "./tools";

const TEST_STRING = "My cat's breath smells like cat food.";
const CAP_14 = new BottleCap(14, new Header());

describe("CompressedBottle", () => {
  it("compresses a stream with lzma2", async () => {
    const clearBottle = new Bottle(CAP_14, asyncify([ asyncOne(Buffer.from(TEST_STRING)) ]));
    const bottle = await writeCompressedBottle(clearBottle.write(), { compression: Compression.LZMA2 });
    const data = await drain(bottle.write());

    const b = await Bottle.read(byteReader(asyncify([ data ])));
    b.cap.type.should.eql(BottleType.COMPRESSED);
    b.cap.header.toString().should.eql("Header(U8(0)=0)");

    const b2 = (await readCompressedBottle(b)).bottle;
    b2.cap.type.should.eql(14);
    b2.cap.header.toString().should.eql("Header()");
    (await drain(await b2.nextDataStream())).toString().should.eql(TEST_STRING);
  });

  it("compresses a stream with snappy", async () => {
    const clearBottle = new Bottle(CAP_14, asyncify([ asyncOne(Buffer.from(TEST_STRING)) ]));
    const bottle = await writeCompressedBottle(clearBottle.write(), { compression: Compression.SNAPPY });
    const data = await drain(bottle.write());

    const b = await Bottle.read(byteReader(asyncify([ data ])));
    b.cap.type.should.eql(BottleType.COMPRESSED);
    b.cap.header.toString().should.eql("Header(U8(0)=1, U8(1)=16)");

    const b2 = (await readCompressedBottle(b)).bottle;
    b2.cap.type.should.eql(14);
    b2.cap.header.toString().should.eql("Header()");
    (await drain(await b2.nextDataStream())).toString().should.eql(TEST_STRING);
  });

  it("compresses multiple blocks with snappy", async () => {
    const LARGE = prngBytes(Math.pow(2, 20));
    const clearBottle = new Bottle(CAP_14, asyncify([ asyncOne(LARGE) ]));
    const bottle = await writeCompressedBottle(clearBottle.write(), {
      compression: Compression.SNAPPY,
      snappyBlockSize: 16384,
    });
    const data = await drain(bottle.write());

    const b = await Bottle.read(byteReader(asyncify([ data ])));
    b.cap.type.should.eql(BottleType.COMPRESSED);
    b.cap.header.toString().should.eql("Header(U8(0)=1, U8(1)=14)");

    const b2 = (await readCompressedBottle(b)).bottle;
    b2.cap.type.should.eql(14);
    b2.cap.header.toString().should.eql("Header()");
    (await drain(await b2.nextDataStream())).should.eql(LARGE);
  });
});
