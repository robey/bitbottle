"use strict";

import * as bottle_header from "../../lib/lib4bottle/bottle_header";

import "should";
import "source-map-support/register";

describe("bottle_header", () => {
  it("pack", () => {
    let m = new bottle_header.Header();
    m.addBool(1);
    Buffer.concat(m.pack()).toString("hex").should.eql("c400");
    m.addNumber(10, 1000);
    Buffer.concat(m.pack()).toString("hex").should.eql("c400a802e803");
    m.addString(3, "iron");
    Buffer.concat(m.pack()).toString("hex").should.eql("c400a802e8030c0469726f6e");
    m = new bottle_header.Header();
    m.addStringList(15, [ "one", "two", "three" ]);
    Buffer.concat(m.pack()).toString("hex").should.eql("3c0d6f6e650074776f007468726565");
  });

  it("unpack", () => {
    bottle_header.unpack(new Buffer("c400", "hex")).fields.should.eql([ { type: bottle_header.TYPE_BOOL, id: 1 } ]);
    bottle_header.unpack(new Buffer("c400a802e803", "hex")).fields.should.eql([
      { type: bottle_header.TYPE_BOOL, id: 1 },
      { type: bottle_header.TYPE_ZINT, id: 10, number: 1000 }
    ]);
    bottle_header.unpack(new Buffer("c400a802e8030c0469726f6e", "hex")).fields.should.eql([
      { type: bottle_header.TYPE_BOOL, id: 1 },
      { type: bottle_header.TYPE_ZINT, id: 10, number: 1000 },
      { type: bottle_header.TYPE_STRING, id: 3, list: [ "iron" ], string: "iron" }
    ]);
    bottle_header.unpack(new Buffer("3c0d6f6e650074776f007468726565", "hex")).fields.should.eql([
      { type: bottle_header.TYPE_STRING, id: 15, list: [ "one", "two", "three" ], string: "one\x00two\x00three" }
    ]);
  });

  it("unpack truncated", () => {
    (() => bottle_header.unpack(new Buffer("c4", "hex"))).should.throw(/truncated/i);
    (() => bottle_header.unpack(new Buffer("c401", "hex"))).should.throw(/truncated/i);
    (() => bottle_header.unpack(new Buffer("c403ffff", "hex"))).should.throw(/truncated/i);
  });
});
