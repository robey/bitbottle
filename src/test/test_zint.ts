import * as zint from "../zint";

import "should";
import "source-map-support/register";

describe("zint", () => {
  it("encode packed", () => {
    zint.encodePackedInt(0).toString("hex").should.eql("00");
    zint.encodePackedInt(100).toString("hex").should.eql("64");
    zint.encodePackedInt(129).toString("hex").should.eql("81");
    zint.encodePackedInt(127).toString("hex").should.eql("7f");
    zint.encodePackedInt(256).toString("hex").should.eql("0001");
    zint.encodePackedInt(987654321).toString("hex").should.eql("b168de3a");
  });

  it("decode packed", () => {
    zint.decodePackedInt(new Buffer("00", "hex")).should.eql(0);
    zint.decodePackedInt(new Buffer("ff", "hex")).should.eql(255);
    zint.decodePackedInt(new Buffer("64", "hex")).should.eql(100);
    zint.decodePackedInt(new Buffer("81", "hex")).should.eql(129);
    zint.decodePackedInt(new Buffer("7f", "hex")).should.eql(127);
    zint.decodePackedInt(new Buffer("0001", "hex")).should.eql(256);
    zint.decodePackedInt(new Buffer("b168de3a", "hex")).should.eql(987654321);
  });

  it("encode length", () => {
    zint.encodeLength(0).toString("hex").should.eql("00");
    zint.encodeLength(1).toString("hex").should.eql("01");
    zint.encodeLength(100).toString("hex").should.eql("64");
    zint.encodeLength(127).toString("hex").should.eql("7f");
    zint.encodeLength(128).toString("hex").should.eql("e0");
    zint.encodeLength(129).toString("hex").should.eql("8102");
    zint.encodeLength(512).toString("hex").should.eql("e2");
    zint.encodeLength(1024).toString("hex").should.eql("e3");
    zint.encodeLength(12345).toString("hex").should.eql("b9c0");
    zint.encodeLength(1901626).toString("hex").should.eql("da21e8");
    zint.encodeLength(Math.pow(2, 21)).toString("hex").should.eql("ee");
  });

  it("determine length of length", () => {
    zint.lengthLength(0x00).should.eql(1);
    zint.lengthLength(0x01).should.eql(1);
    zint.lengthLength(0x64).should.eql(1);
    zint.lengthLength(0x81).should.eql(2);
    zint.lengthLength(0x7f).should.eql(1);
    zint.lengthLength(0xe1).should.eql(1);
    zint.lengthLength(0xe3).should.eql(1);
    zint.lengthLength(0xd9).should.eql(3);
    zint.lengthLength(0xee).should.eql(1);
    zint.lengthLength(0xef).should.eql(1);
  });

  it("read length", () => {
    zint.decodeLength(new Buffer("00", "hex")).should.eql(0);
    zint.decodeLength(new Buffer("01", "hex")).should.eql(1);
    zint.decodeLength(new Buffer("64", "hex")).should.eql(100);
    zint.decodeLength(new Buffer("7f", "hex")).should.eql(127);
    zint.decodeLength(new Buffer("e0", "hex")).should.eql(128);
    zint.decodeLength(new Buffer("8102", "hex")).should.eql(129);
    zint.decodeLength(new Buffer("e2", "hex")).should.eql(512);
    zint.decodeLength(new Buffer("e3", "hex")).should.eql(1024);
    zint.decodeLength(new Buffer("b9c0", "hex")).should.eql(12345);
    zint.decodeLength(new Buffer("da21e8", "hex")).should.eql(1901626);
    zint.decodeLength(new Buffer("ee", "hex")).should.eql(Math.pow(2, 21));
  });
});
