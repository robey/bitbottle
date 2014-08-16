toolkit = require "stream-toolkit"
util = require "util"

bottle_header = require "../lib/4q/bottle_header"

describe "bottle_header", ->
  it "pack", ->
    m = new bottle_header.Header()
    m.addBool(1)
    toolkit.toHex(Buffer.concat(m.pack())).should.eql "c400"
    m.addNumber(10, 1000)
    toolkit.toHex(Buffer.concat(m.pack())).should.eql "c400a802e803"
    m.addString(3, "iron")
    toolkit.toHex(Buffer.concat(m.pack())).should.eql "c400a802e8030c0469726f6e"
    m = new bottle_header.Header()
    m.addStringList(15, [ "one", "two", "three" ])
    toolkit.toHex(Buffer.concat(m.pack())).should.eql "3c0d6f6e650074776f007468726565"

  it "unpack", ->
    bottle_header.unpack(toolkit.fromHex("c400")).fields.should.eql [ { type: bottle_header.TYPE_BOOL, id: 1 }]
    bottle_header.unpack(toolkit.fromHex("c400a802e803")).fields.should.eql [
      { type: bottle_header.TYPE_BOOL, id: 1 }
      { type: bottle_header.TYPE_ZINT, id: 10, number: 1000 }
    ]
    bottle_header.unpack(toolkit.fromHex("c400a802e8030c0469726f6e")).fields.should.eql [
      { type: bottle_header.TYPE_BOOL, id: 1 }
      { type: bottle_header.TYPE_ZINT, id: 10, number: 1000 }
      { type: bottle_header.TYPE_STRING, id: 3, list: [ "iron" ] }
    ]
    bottle_header.unpack(toolkit.fromHex("3c0d6f6e650074776f007468726565")).fields.should.eql [
      { type: bottle_header.TYPE_STRING, id: 15, list: [ "one", "two", "three" ] }
    ]

  it "unpack truncated", ->
    (-> bottle_header.unpack(toolkit.fromHex("c4"))).should.throw /truncated/i
    (-> bottle_header.unpack(toolkit.fromHex("c401"))).should.throw /truncated/i
    (-> bottle_header.unpack(toolkit.fromHex("c403ffff"))).should.throw /truncated/i
