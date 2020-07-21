import { byteReader } from "ballvalve";
import { asyncify, asyncOne } from "../async";
import { Bottle } from "../bottle";
import { BottleCap, BottleType } from "../bottle_cap";
import { Header } from "../header";
import { Hash, readSignedBottle, writeSignedBottle } from "../signed_bottle";
import { drain } from "./tools";

import "should";
import "source-map-support/register";

const CAP_14 = new BottleCap(14, new Header());

async function thrown(valid: Promise<void>): Promise<string> {
  try {
    await valid;
    return "";
  } catch (error) {
    return error.message;
  }
}


describe("SignedBottle", () => {
  it("hashes a small stream", async () => {
    const b1 = new Bottle(CAP_14, asyncify([ asyncOne(Buffer.from("i choose you!")) ]));
    const b2 = await writeSignedBottle(Hash.SHA256, b1);
    const data = await drain(b2.write());

    // parse the raw sections
    const b3 = await Bottle.read(byteReader([ data ]));
    b3.cap.type.should.eql(BottleType.SIGNED);
    b3.cap.header.toString().should.eql("Header(U8(0)=0)");

    const b4 = await Bottle.read(byteReader(await b3.nextDataStream()));
    b4.cap.type.should.eql(14);
    b4.cap.header.toString().should.eql("Header()");

    (await drain(await b4.nextDataStream())).toString().should.eql("i choose you!");
    await b4.done();
    (await drain(await b3.nextDataStream())).toString("hex").should.eql(
      "a8f943a0d5669b2ea8d2cad0ce240be639aebdbdcbcef3a8c452283f9ae60eab"
    );
    await b3.done();
  });

  it("verifies a hashed stream", async () => {
    const b1 = new Bottle(CAP_14, asyncify([ asyncOne(Buffer.from("i choose you!")) ]));
    const b2 = await writeSignedBottle(Hash.SHA256, b1);

    const { bottle: b3, valid } = await readSignedBottle(b2);
    b3.cap.type.should.eql(14);
    b3.cap.header.toString().should.eql("Header()");
    (await drain(await b3.nextDataStream())).toString().should.eql("i choose you!");
    await b3.done();

    (await thrown(valid)).should.eql("");
  });

  it("does not verify a corrupt stream", async () => {
    const b1 = new Bottle(CAP_14, asyncify([ asyncOne(Buffer.from("i choose you!")) ]));
    const b2 = await writeSignedBottle(Hash.SHA256, b1);

    // mess up something roughly in the middle of the 20-byte hash
    const data = await drain(b2.write());
    data[data.length - 16] = 0xff;
    const b2bad = await Bottle.read(byteReader([ data ]));

    const { bottle: b3, valid } = await readSignedBottle(b2bad);
    b3.cap.type.should.eql(14);
    b3.cap.header.toString().should.eql("Header()");
    (await drain(await b3.nextDataStream())).toString().should.eql("i choose you!");
    await b3.done();

    (await thrown(valid)).should.match(/Mismatched digest/);
  });
});
