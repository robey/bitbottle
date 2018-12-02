import { Header } from "../header";

import "should";
import "source-map-support/register";

describe("header", () => {
  it("pack", () => {
    const h = new Header();
    h.addBoolean(1);
    h.pack().toString("hex").should.eql("00c4");
    h.addInt(10, 1000);
    h.pack().toString("hex").should.eql("00c402a8e803");
    h.addString(3, "iron");
    h.pack().toString("hex").should.eql("00c402a8e803040c69726f6e");
    const h2 = new Header();
    h2.addStringList(15, [ "one", "two", "three" ]);
    h2.pack().toString("hex").should.eql("0d3c6f6e650074776f007468726565");
  });

  it("unpack", () => {
    Header.unpack(Buffer.from("00c4", "hex")).toString().should.eql("Header(B1)");
    Header.unpack(Buffer.from("00c402a8e803", "hex")).toString().should.eql(
      "Header(B1, I10=1000)"
    );
    Header.unpack(Buffer.from("00c402a8e803040c69726f6e", "hex")).toString().should.eql(
      "Header(B1, I10=1000, S3=iron)"
    );
    Header.unpack(Buffer.from("0d3c6f6e650074776f007468726565", "hex")).toString().should.eql(
      "Header(S15=one,two,three)"
    );
  });

  it("unpack truncated", () => {
    (() => Header.unpack(Buffer.from("c4", "hex"))).should.throw(/truncated/i);
    (() => Header.unpack(Buffer.from("c401", "hex"))).should.throw(/truncated/i);
    (() => Header.unpack(Buffer.from("c403ffff", "hex"))).should.throw(/truncated/i);
  });

  it("pack/unpack long fields", () => {
    const b65 = Buffer.alloc(65);
    const b135 = Buffer.alloc(135);
    for (let i = 0; i < b65.length; i++) b65[i] = 0x40;
    for (let i = 0; i < b135.length; i++) b135[i] = 0x40;
    const h1 = new Header().addString(1, b65.toString()).pack();
    const h2 = new Header().addString(2, b135.toString()).pack();
    Header.unpack(h1).toString().should.eql(`Header(S1=${b65.toString()})`);
    Header.unpack(h2).toString().should.eql(`Header(S2=${b135.toString()})`);
  });

  it("get", () => {
    const h = new Header();
    h.addBoolean(1);
    h.addInt(10, 1000);
    h.addString(3, "iron");
    h.addStringList(15, [ "one", "two", "three" ]);

    h.getBoolean(1).should.eql(true);
    h.getBoolean(10).should.eql(false);
    (h.getInt(10) || -1).should.eql(1000);
    (h.getInt(3) || -1).should.eql(-1);
    (h.getString(3) || "q").should.eql("iron");
    (h.getString(1) || "q").should.eql("q");
    (h.getStringList(15) || []).should.eql([ "one", "two", "three" ]);
    (h.getStringList(10) || []).should.eql([]);
  });
});
