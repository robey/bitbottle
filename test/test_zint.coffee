toolkit = require "stream-toolkit"
util = require "util"

zint = require "../lib/4q/lib4q/zint"

describe "zint", ->
  it "encode", ->
    toolkit.toHex(zint.encodePackedInt(0)).should.eql "00"
    toolkit.toHex(zint.encodePackedInt(100)).should.eql "64"
    toolkit.toHex(zint.encodePackedInt(129)).should.eql "81"
    toolkit.toHex(zint.encodePackedInt(127)).should.eql "7f"
    toolkit.toHex(zint.encodePackedInt(256)).should.eql "0001"
    toolkit.toHex(zint.encodePackedInt(987654321)).should.eql "b168de3a"

  it "decode", ->
    zint.decodePackedInt(toolkit.fromHex("00")).should.eql 0
    zint.decodePackedInt(toolkit.fromHex("ff")).should.eql 255
    zint.decodePackedInt(toolkit.fromHex("64")).should.eql 100
    zint.decodePackedInt(toolkit.fromHex("81")).should.eql 129
    zint.decodePackedInt(toolkit.fromHex("7f")).should.eql 127
    zint.decodePackedInt(toolkit.fromHex("0001")).should.eql 256
    zint.decodePackedInt(toolkit.fromHex("b168de3a")).should.eql 987654321
