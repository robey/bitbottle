toolkit = require "stream-toolkit"
util = require "util"

zint = require "../lib/4q/zint"

describe "zint", ->
  it "encode", ->
    toolkit.toHex(zint.encodeZint(0)).should.eql "00"
    toolkit.toHex(zint.encodeZint(100)).should.eql "64"
    toolkit.toHex(zint.encodeZint(129)).should.eql "8101"
    toolkit.toHex(zint.encodeZint(127)).should.eql "7f"
    toolkit.toHex(zint.encodeZint(987654321)).should.eql "b1d1f9d603"

  it "decode", ->
    zint.decodeZint(toolkit.fromHex("00"), 0).should.eql [ 0, 1 ]
    zint.decodeZint(toolkit.fromHex("ff00ff"), 1).should.eql [ 0, 2 ]
    zint.decodeZint(toolkit.fromHex("64"), 0).should.eql [ 100, 1 ]
    zint.decodeZint(toolkit.fromHex("8101"), 0).should.eql [ 129, 2 ]
    zint.decodeZint(toolkit.fromHex("7f"), 0).should.eql [ 127, 1 ]
    zint.decodeZint(toolkit.fromHex("b1d1f9d603"), 0).should.eql [ 987654321, 5 ]
