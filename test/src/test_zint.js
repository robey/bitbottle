const should = require("should");
const toolkit = require("stream-toolkit");
const util = require("util");
const zint = require("../../lib/lib4q/zint");

require("source-map-support").install();

describe("zint", () => {
  it("encode", () => {
    zint.encodePackedInt(0).toString("hex").should.eql("00");
    zint.encodePackedInt(100).toString("hex").should.eql("64");
    zint.encodePackedInt(129).toString("hex").should.eql("81");
    zint.encodePackedInt(127).toString("hex").should.eql("7f");
    zint.encodePackedInt(256).toString("hex").should.eql("0001");
    zint.encodePackedInt(987654321).toString("hex").should.eql("b168de3a");
  });

  it("decode", () => {
    zint.decodePackedInt(new Buffer("00", "hex")).should.eql(0);
    zint.decodePackedInt(new Buffer("ff", "hex")).should.eql(255);
    zint.decodePackedInt(new Buffer("64", "hex")).should.eql(100);
    zint.decodePackedInt(new Buffer("81", "hex")).should.eql(129);
    zint.decodePackedInt(new Buffer("7f", "hex")).should.eql(127);
    zint.decodePackedInt(new Buffer("0001", "hex")).should.eql(256);
    zint.decodePackedInt(new Buffer("b168de3a", "hex")).should.eql(987654321);
  });
});
