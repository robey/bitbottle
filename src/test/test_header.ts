import {
  Header,
  Type,
} from "../header";

import "should";
import "source-map-support/register";

describe("header", () => {
  it("pack", () => {
    let m = new Header();
    m.addBool(1);
    m.pack().toString("hex").should.eql("00c4");
    m.addNumber(10, 1000);
    m.pack().toString("hex").should.eql("00c402a8e803");
    m.addString(3, "iron");
    m.pack().toString("hex").should.eql("00c402a8e803040c69726f6e");
    m = new Header();
    m.addStringList(15, [ "one", "two", "three" ]);
    m.pack().toString("hex").should.eql("0d3c6f6e650074776f007468726565");
  });

  it("unpack", () => {
    Header.unpack(new Buffer("00c4", "hex")).toString().should.eql("Header(B1)");
    Header.unpack(new Buffer("00c402a8e803", "hex")).toString().should.eql(
      "Header(B1, I10=1000)"
    );
    Header.unpack(new Buffer("00c402a8e803040c69726f6e", "hex")).toString().should.eql(
      "Header(B1, I10=1000, S3=iron)"
    );
    Header.unpack(new Buffer("0d3c6f6e650074776f007468726565", "hex")).toString().should.eql(
      "Header(S15=one,two,three)"
    );
  });

  it("unpack truncated", () => {
    (() => Header.unpack(new Buffer("c4", "hex"))).should.throw(/truncated/i);
    (() => Header.unpack(new Buffer("c401", "hex"))).should.throw(/truncated/i);
    (() => Header.unpack(new Buffer("c403ffff", "hex"))).should.throw(/truncated/i);
  });
});
