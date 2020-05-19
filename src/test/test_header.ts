import { Header } from "../header";

import "should";
import "source-map-support/register";

describe("header", () => {
  it("pack", () => {
    const h = new Header();
    h.addFlag(1);
    h.pack().toString("hex").should.eql("01");
    h.addU8(10, 10);
    h.pack().toString("hex").should.eql("011a0a");
    h.addU16(10, 1000);
    h.pack().toString("hex").should.eql("011a0a2ae803");
    h.addString(3, "iron");
    h.pack().toString("hex").should.eql("011a0a2ae803530469726f6e");

    const h2 = new Header();
    h2.addU32(15, 0xabcd1234);
    h2.addU64(14, 0x12345678 * Math.pow(2, 32) + 0x9a000000);
    h2.pack().toString("hex").should.eql("3f3412cdab4e0000009a78563412");
  });

  it("unpack", () => {
    Header.unpack(Buffer.from("01", "hex")).toString().should.eql("Header(F(1))");
    Header.unpack(Buffer.from("011a0a", "hex")).toString().should.eql(
      "Header(F(1), U8(10)=10)"
    );
    Header.unpack(Buffer.from("011a0a2ae803", "hex")).toString().should.eql(
      "Header(F(1), U8(10)=10, U16(10)=1000)"
    );
    Header.unpack(Buffer.from("011a0a2ae803530469726f6e", "hex")).toString().should.eql(
      `Header(F(1), U8(10)=10, U16(10)=1000, S(3)="iron")`
    );
    Header.unpack(Buffer.from("3f3412cdab4e0000009a78563400", "hex")).toString().should.eql(
      "Header(U32(15)=2882343476, U64(14)=14731774768709632)"
    );
  });

  it("unpack truncated", () => {
    (() => Header.unpack(Buffer.from("30", "hex"))).should.throw(/truncated/i);
    (() => Header.unpack(Buffer.from("30ff", "hex"))).should.throw(/truncated/i);
    (() => Header.unpack(Buffer.from("30ffffff", "hex"))).should.throw(/truncated/i);
  });

  it("pack/unpack long fields", () => {
    const b65 = Buffer.alloc(65);
    const b135 = Buffer.alloc(135);
    for (let i = 0; i < b65.length; i++) b65[i] = 0x40;
    for (let i = 0; i < b135.length; i++) b135[i] = 0x40;
    const h1 = new Header().addString(1, b65.toString()).pack();
    const h2 = new Header().addString(2, b135.toString()).pack();
    Header.unpack(h1).toString().should.eql(`Header(S(1)="${b65.toString()}")`);
    Header.unpack(h2).toString().should.eql(`Header(S(2)="${b135.toString()}")`);
  });

  it("get", () => {
    const h = new Header();
    h.addFlag(1);
    h.addU16(10, 1000);
    h.addU32(11, 900);
    h.addString(3, "iron");

    h.getFlag(1).should.eql(true);
    h.getFlag(10).should.eql(false);
    (h.getU16(10) || -1).should.eql(1000);
    (h.getU32(11) || -1).should.eql(900);
    (h.getString(3) || "q").should.eql("iron");
    (h.getString(1) || "q").should.eql("q");
  });
});
