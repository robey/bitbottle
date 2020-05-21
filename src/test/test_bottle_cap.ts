import { byteReader } from "ballvalve";
import { BottleCap } from "../bottle_cap";
import { Header } from "../header";

import "should";
import "source-map-support/register";

const MAGIC_STRING = "f09f8dbc00";

function read(hex: string): Promise<BottleCap> {
  return BottleCap.read(byteReader([ Buffer.from(hex, "hex") ]));
}


describe("BottleCap.write", () => {
  it("writes a bottle cap", async () => {
    const b = new BottleCap(10, new Header().addU8(0, 150)).write();
    b.toString("hex").should.eql(`${MAGIC_STRING}0a02001096d528167a`);
  });

  it("validates the header", async () => {
    await read("00").should.be.rejectedWith(/End of stream/);
    await read("00ff00ff00ff00ffcccccccc").should.be.rejectedWith(/magic/);
    await read("f09f8dbcff000000cccccccc").should.be.rejectedWith(/version/);
    // await read("f09f8dbc00ff0000cccccccc").should.be.rejectedWith(/flags/);
    await read("f09f8dbc00000000cccccccc").should.be.rejectedWith(/CRC/);
  });

  it("reads the header", async () => {
    const b = await read("f09f8dbc000c000081d6cafd");
    b.type.should.eql(12);
    b.header.toString().should.eql("Header()");

    const b2 = await read("f09f8dbc000e02001096158e968f");
    b2.type.should.eql(14);
    b2.header.toString().should.eql("Header(U8(0)=150)");
  });
});
