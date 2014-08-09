toolkit = require "stream-toolkit"
util = require "util"

metadata = require "../lib/4q/metadata"

describe "metadata", ->
  it "pack", ->
    m = new metadata.Metadata()
    m.addBool(1)
    toolkit.toHex(Buffer.concat(m.pack())).should.eql "c400"
    m.addNumber(10, 1000)
    toolkit.toHex(Buffer.concat(m.pack())).should.eql "c400a802e807"
    m.addString(3, "iron")
    toolkit.toHex(Buffer.concat(m.pack())).should.eql "c400a802e8070c0469726f6e"
    m = new metadata.Metadata()
    m.addStringList(15, [ "one", "two", "three" ])
    toolkit.toHex(Buffer.concat(m.pack())).should.eql "3c0d6f6e650074776f007468726565"

  it "unpack", ->
    metadata.unpack(toolkit.fromHex("c400")).fields.should.eql [ { type: metadata.TYPE_BOOL, id: 1 }]
    metadata.unpack(toolkit.fromHex("c400a802e807")).fields.should.eql [
      { type: metadata.TYPE_BOOL, id: 1 }
      { type: metadata.TYPE_ZINT, id: 10, number: 1000 }
    ]
    metadata.unpack(toolkit.fromHex("c400a802e8070c0469726f6e")).fields.should.eql [
      { type: metadata.TYPE_BOOL, id: 1 }
      { type: metadata.TYPE_ZINT, id: 10, number: 1000 }
      { type: metadata.TYPE_STRING, id: 3, list: [ "iron" ] }
    ]
    metadata.unpack(toolkit.fromHex("3c0d6f6e650074776f007468726565")).fields.should.eql [
      { type: metadata.TYPE_STRING, id: 15, list: [ "one", "two", "three" ] }
    ]

  it "unpack truncated", ->
    (-> metadata.unpack(toolkit.fromHex("c4"))).should.throw /truncated/i
    (-> metadata.unpack(toolkit.fromHex("c401"))).should.throw /truncated/i
    (-> metadata.unpack(toolkit.fromHex("c403ffff"))).should.throw /truncated/i
