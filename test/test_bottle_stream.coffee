helpers = require "./helpers"
mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
stream = require "stream"
should = require "should"
util = require "util"

bottle_stream = require "../lib/4q/bottle_stream"
metadata = require "../lib/4q/metadata"

bufferSink = helpers.bufferSink
bufferSource = helpers.bufferSource
fromHex = helpers.fromHex
future = mocha_sprinkles.future
toHex = helpers.toHex


describe "Writable4QStream", ->
  it "writes magic", future ->
    sink = bufferSink()
    b = new bottle_stream.Writable4QStream(sink)
    b.writeMagic().then ->
      sink.getBuffer().should.eql bottle_stream.MAGIC

  it "writes a bottle header", future ->
    sink = bufferSink()
    b = new bottle_stream.Writable4QStream(sink)
    metadata = new metadata.Metadata()
    metadata.addNumber(0, 150)
    b.writeBottleHeader(10, metadata).then ->
      toHex(sink.getBuffer()).should.eql "a00480029601"

  it "writes data", future ->
    data = bufferSource(fromHex("ff00ff00"))
    sink = bufferSink()
    b = new bottle_stream.Writable4QStream(sink)
    b.writeData(data, 4).then ->
      toHex(sink.getBuffer()).should.eql "6004ff00ff00"

  it "streams data", future ->
    # just to verify that the data is written as it comes in, and the event isn't triggered until completion.
    data = fromHex("ff00")
    slowStream = new stream.Readable()
    slowStream._read = (n) ->
    slowStream.push data
    sink = bufferSink()
    b = new bottle_stream.Writable4QStream(sink)
    b.writeData(slowStream, 4).then ->
      toHex(sink.getBuffer()).should.eql "6004ff00ff00"
    Q.delay(100).then ->
      slowStream.push data
      Q.delay(100).then ->
        slowStream.push null

  it "writes several datas", future ->
    data1 = bufferSource(fromHex("f0f0f0"))
    data2 = bufferSource(fromHex("e0e0e0"))
    data3 = bufferSource(fromHex("cccccc"))
    sink = bufferSink()
    b = new bottle_stream.Writable4QStream(sink)
    b.writeData(data1, 3).then ->
      b.writeData(data2, 3)
    .then ->
      b.writeData(data3, 3)
    .then ->
      b.writeEndData()
    .then ->
      toHex(sink.getBuffer()).should.eql "6003f0f0f06003e0e0e06003cccccc00"
