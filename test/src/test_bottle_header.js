"use strict";

import {
  Header,
  packHeader,
  TYPE_BOOL,
  TYPE_STRING,
  TYPE_ZINT,
  unpackHeader
} from "../../lib/lib4bottle/bottle_header";

import "should";
import "source-map-support/register";

describe("bottle_header", () => {
  it("pack", () => {
    let m = new Header();
    m.addBool(1);
    packHeader(m).toString("hex").should.eql("c400");
    m.addNumber(10, 1000);
    packHeader(m).toString("hex").should.eql("c400a802e803");
    m.addString(3, "iron");
    packHeader(m).toString("hex").should.eql("c400a802e8030c0469726f6e");
    m = new Header();
    m.addStringList(15, [ "one", "two", "three" ]);
    packHeader(m).toString("hex").should.eql("3c0d6f6e650074776f007468726565");
  });

  it("unpack", () => {
    unpackHeader(new Buffer("c400", "hex")).fields.should.eql([ { type: TYPE_BOOL, id: 1 } ]);
    unpackHeader(new Buffer("c400a802e803", "hex")).fields.should.eql([
      { type: TYPE_BOOL, id: 1 },
      { type: TYPE_ZINT, id: 10, number: 1000 }
    ]);
    unpackHeader(new Buffer("c400a802e8030c0469726f6e", "hex")).fields.should.eql([
      { type: TYPE_BOOL, id: 1 },
      { type: TYPE_ZINT, id: 10, number: 1000 },
      { type: TYPE_STRING, id: 3, list: [ "iron" ], string: "iron" }
    ]);
    unpackHeader(new Buffer("3c0d6f6e650074776f007468726565", "hex")).fields.should.eql([
      { type: TYPE_STRING, id: 15, list: [ "one", "two", "three" ], string: "one\x00two\x00three" }
    ]);
  });

  it("unpack truncated", () => {
    (() => unpackHeader(new Buffer("c4", "hex"))).should.throw(/truncated/i);
    (() => unpackHeader(new Buffer("c401", "hex"))).should.throw(/truncated/i);
    (() => unpackHeader(new Buffer("c403ffff", "hex"))).should.throw(/truncated/i);
  });
});
