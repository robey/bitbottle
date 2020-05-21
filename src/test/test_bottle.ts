import { asyncIter, byteReader } from "ballvalve";
import { Bottle } from "../bottle";
import { BottleCap, MAGIC } from "../bottle_cap";
import { Header } from "../header";
import { fromHex, hex } from "./tools";

import "should";
import "source-map-support/register";

const MAGIC_STRING = "f09f8dbc00";

const CAP_10 = new BottleCap(10, new Header());
const CAP_10_HEX = `${MAGIC_STRING}0a000033aa47f9`;
const CAP_14 = new BottleCap(14, new Header());
const CAP_14_HEX = `${MAGIC_STRING}0e0000ef024efe`;

function read(hex: string): Promise<BottleCap> {
  return BottleCap.read(byteReader([ Buffer.from(hex, "hex") ]));
}


describe("Bottle.write", () => {
  it("writes a bottle header", async () => {
    const cap = new BottleCap(10, new Header().addU8(0, 150));
    const b = new Bottle(cap, asyncIter([]));
    (await hex(b.write())).should.eql(`${MAGIC_STRING}0a02001096d528167ac0`);
  });

  it("writes data", async () => {
    const b = new Bottle(CAP_10, asyncIter([ fromHex("ff00ff00") ]));
    (await hex(b.write())).should.eql(`${CAP_10_HEX}4004ff00ff00c0`);
  });

  it("writes a nested bottle", async () => {
    const b2 = new Bottle(CAP_14, asyncIter([]));
    const b = new Bottle(CAP_10, asyncIter([ b2 ]));
    (await hex(b.write())).should.eql(`${CAP_10_HEX}80${CAP_14_HEX}c0c0`);
  });

  it("writes a nested bottle of data", async () => {
    const b2 = new Bottle(CAP_14, asyncIter([ fromHex("636174") ]));
    const b = new Bottle(CAP_10, asyncIter([ b2 ]));
    (await hex(b.write())).should.eql(`${CAP_10_HEX}80${CAP_14_HEX}4003636174c0c0`);
  });

});
