import { byteReader } from "ballvalve";
import { asyncify } from "../async";
import { Bottle } from "../bottle";
import { BottleCap, MAGIC } from "../bottle_cap";
import { Header } from "../header";
import { delay, drain, fromHex, hex } from "./tools";

import "should";
import "source-map-support/register";

const MAGIC_STRING = "f09f8dbc00";

const CAP_10 = new BottleCap(10, new Header());
const CAP_10_HEX = `${MAGIC_STRING}0a000033aa47f9`;
const CAP_14 = new BottleCap(14, new Header());
const CAP_14_HEX = `${MAGIC_STRING}0e0000ef024efe`;


describe("Bottle.write", () => {
  it("writes a bottle header", async () => {
    const cap = new BottleCap(10, new Header().addInt(0, 150));
    const b = new Bottle(cap, asyncify([]));
    (await hex(b.write())).should.eql(`${MAGIC_STRING}0a02000096843ad430c0`);
  });

  it("writes data", async () => {
    const b = new Bottle(CAP_10, asyncify([ fromHex("ff00ff00") ]));
    (await hex(b.write())).should.eql(`${CAP_10_HEX}4004ff00ff00c0`);
  });

  it("writes a nested bottle", async () => {
    const b2 = new Bottle(CAP_14, asyncify([]));
    const b = new Bottle(CAP_10, asyncify([ b2 ]));
    (await hex(b.write())).should.eql(`${CAP_10_HEX}80${CAP_14_HEX}c0c0`);
  });

  it("writes a nested bottle of data", async () => {
    const b2 = new Bottle(CAP_14, asyncify([ fromHex("636174") ]));
    const b = new Bottle(CAP_10, asyncify([ b2 ]));
    (await hex(b.write())).should.eql(`${CAP_10_HEX}80${CAP_14_HEX}4003636174c0c0`);
  });

  it("streams data", async () => {
    // just to verify that the data is written as it comes in, and the event isn't triggered until completion.
    let done = false;
    async function* data(): AsyncIterator<Buffer> {
      await delay(10);
      yield Buffer.from("c44c", "hex");
      await delay(10);
      done = true;
    }

    const b = new Bottle(CAP_14, asyncify([ data() ]));
    done.should.eql(false);
    (await hex(b.write())).should.eql(`${CAP_14_HEX}4002c44cc0`);
    done.should.eql(true);

    const b2 = new Bottle(CAP_14, asyncify([ data(), fromHex("abcdef") ]));
    (await hex(b2.write())).should.eql(`${CAP_14_HEX}4002c44c4003abcdefc0`);
  });

  it("writes several streams", async () => {
    const data1 = fromHex("f0f0f0");
    const data2 = fromHex("e0e0e0");
    const data3 = fromHex("cccccc");

    async function* streams(): AsyncIterator<AsyncIterator<Buffer>> {
      await delay(10);
      yield data1;
      await delay(10);
      yield data2;
      await delay(10);
      yield data3;
    }

    const b = new Bottle(CAP_14, streams());
    (await hex(b.write())).should.eql(`${CAP_14_HEX}4003f0f0f04003e0e0e04003ccccccc0`);
  });
});

describe("Bottle.read", () => {
  it("reads data", async () => {
    const b = await Bottle.read(byteReader(fromHex(`${CAP_10_HEX}400568656c6c6fc0`)));
    b.cap.toString().should.eql("10:Header()");
    const s1 = await b.nextStream();
    (s1 !== undefined).should.eql(true);
    (s1 instanceof Bottle).should.eql(false);
    if (s1 && !(s1 instanceof Bottle)) (await drain(s1)).toString().should.eql("hello");
    (await b.nextStream() === undefined).should.eql(true);
  });

  it("reads a continuing data block", async () => {
    const bigBlock = Buffer.alloc(64);
    Buffer.from("whatchamacallit").copy(bigBlock, 23);
    const b = await Bottle.read(byteReader(fromHex(`${CAP_10_HEX}4041${bigBlock.toString("hex")}0568656c6c6fc0`)));
    b.cap.toString().should.eql("10:Header()");
    const s1 = await b.nextStream();
    (s1 !== undefined).should.eql(true);
    (s1 instanceof Bottle).should.eql(false);
    let result: Buffer = Buffer.alloc(0);
    if (s1 && !(s1 instanceof Bottle)) result = await drain(s1);
    result.length.should.eql(69);
    result.slice(0, 64).should.eql(bigBlock);
    result.slice(64).toString().should.eql("hello");
  });

  it("reads several data streams", async () => {
    const b = await Bottle.read(byteReader(fromHex(`${CAP_14_HEX}4003f0f0f04003e0e0e04003ccccccc0`)));
    b.cap.toString().should.eql("14:Header()");

    const s1 = await b.nextStream();
    (s1 !== undefined).should.eql(true);
    (s1 instanceof Bottle).should.eql(false);
    if (s1 && !(s1 instanceof Bottle)) (await hex(s1)).should.eql("f0f0f0");

    const s2 = await b.nextStream();
    (s2 !== undefined).should.eql(true);
    (s2 instanceof Bottle).should.eql(false);
    if (s2 && !(s2 instanceof Bottle)) (await hex(s2)).should.eql("e0e0e0");

    const s3 = await b.nextStream();
    (s3 !== undefined).should.eql(true);
    (s3 instanceof Bottle).should.eql(false);
    if (s3 && !(s3 instanceof Bottle)) (await hex(s3)).should.eql("cccccc");

    (await b.nextStream() === undefined).should.eql(true);
  });

  it("reads nested bottles", async () => {
    const nested = `${CAP_14_HEX}4003636174c0`;
    const b = await Bottle.read(byteReader(fromHex(`${CAP_10_HEX}80${nested}4003626174c0`)));
    b.cap.toString().should.eql("10:Header()");

    const s1 = await b.nextStream();
    (s1 !== undefined).should.eql(true);
    (s1 instanceof Bottle).should.eql(true);
    if (s1 && (s1 instanceof Bottle)) {
      s1.cap.toString().should.eql("14:Header()");

      const s2 = await s1.nextStream();
      (s2 !== undefined).should.eql(true);
      (s2 instanceof Bottle).should.eql(false);
      if (s2 && !(s2 instanceof Bottle)) (await drain(s2)).toString().should.eql("cat");

      (await s1.nextStream() === undefined).should.eql(true);
    }

    const s3 = await b.nextStream();
    (s3 !== undefined).should.eql(true);
    (s3 instanceof Bottle).should.eql(false);
    if (s3 && !(s3 instanceof Bottle)) (await drain(s3)).toString().should.eql("bat");

    (await b.nextStream() === undefined).should.eql(true);
  });
});
