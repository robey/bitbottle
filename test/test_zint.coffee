util = require "util"

zint = require "../lib/4q/zint"

toHex = (buffer) ->
  strings = [0 ... buffer.length].map (n) ->
    x = buffer[n].toString(16)
    if x.length < 2 then x = "0" + x
    x
  strings.join("")

fromHex = (str) ->
  new Buffer([0 ... str.length / 2].map (i) -> parseInt(str[i * 2 ... (i + 1) * 2], 16))


describe "zint", ->
  it "encode", ->
    toHex(zint.encodeZint(0)).should.eql "00"
    toHex(zint.encodeZint(100)).should.eql "64"
    toHex(zint.encodeZint(129)).should.eql "8101"
    toHex(zint.encodeZint(127)).should.eql "7f"
    toHex(zint.encodeZint(987654321)).should.eql "b1d1f9d603"

  it "decode", ->
    zint.decodeZint(fromHex("00"), 0).should.eql [ 0, 1 ]
    zint.decodeZint(fromHex("ff00ff"), 1).should.eql [ 0, 2 ]
    zint.decodeZint(fromHex("64"), 0).should.eql [ 100, 1 ]
    zint.decodeZint(fromHex("8101"), 0).should.eql [ 129, 2 ]
    zint.decodeZint(fromHex("7f"), 0).should.eql [ 127, 1 ]
    zint.decodeZint(fromHex("b1d1f9d603"), 0).should.eql [ 987654321, 5 ]
