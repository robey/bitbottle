"use strict";

import * as toolkit from "stream-toolkit";
import * as zint from "../../lib/lib4bottle/zint";
import { future } from "mocha-sprinkles";

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
    zint.encodeLength(1).toString("hex").should.eql("01");
    zint.encodeLength(100).toString("hex").should.eql("64");
    zint.encodeLength(129).toString("hex").should.eql("8102");
    zint.encodeLength(127).toString("hex").should.eql("7f");
    zint.encodeLength(256).toString("hex").should.eql("f1");
    zint.encodeLength(1024).toString("hex").should.eql("f3");
    zint.encodeLength(12345).toString("hex").should.eql("d98101");
    zint.encodeLength(3998778).toString("hex").should.eql("ea43d003");
    zint.encodeLength(87654321).toString("hex").should.eql("e1fb9753");
    zint.encodeLength(Math.pow(2, 21)).toString("hex").should.eql("fe");
  });

  it("read length", future(() => {
    const check = (string, expected) => {
      return zint.readLength(toolkit.sourceStream(new Buffer(string, "hex"))).then(val => {
        val.should.eql(expected);
      });
    };

    return Promise.all([
      check("01", 1),
      check("64", 100),
      check("8102", 129),
      check("7f", 127),
      check("f1", 256),
      check("f3", 1024),
      check("d98101", 12345),
      check("ea43d003", 3998778),
      check("e1fb9753", 87654321),
      check("fe", Math.pow(2, 21))
    ]);
  }));
});
