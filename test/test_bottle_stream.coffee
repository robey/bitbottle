mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
stream = require "stream"
should = require "should"
toolkit = require "stream-toolkit"
util = require "util"

bottle_stream = require "../lib/4q/bottle_stream"
metadata = require "../lib/4q/metadata"

future = mocha_sprinkles.future


describe "WritableBottleStream", ->
  it "writes magic", future ->
    sink = new toolkit.SinkStream()
    b = new bottle_stream.WritableBottleStream()
    promise = b.pipe(sink)
    b.writeMagic().then ->
      b.close()
    .then ->
      promise
    .then ->
      sink.getBuffer().should.eql bottle_stream.MAGIC

  it "writes a bottle header", future ->
    sink = new toolkit.SinkStream()
    b = new bottle_stream.WritableBottleStream()
    b.pipe(sink)
    m = new metadata.Metadata()
    m.addNumber(0, 150)
    b.writeBottleHeader(10, m).then ->
      toolkit.toHex(sink.getBuffer()).should.eql "a003800196"

  it "writes data", future ->
    data = new toolkit.SourceStream(toolkit.fromHex("ff00ff00"))
    sink = new toolkit.SinkStream()
    b = new bottle_stream.WritableBottleStream()
    b.pipe(sink)
    b.writeData(data, 4).then ->
      toolkit.toHex(sink.getBuffer()).should.eql "0104ff00ff00"

  it "writes nested bottle data", future ->
    sink = new toolkit.SinkStream()
    b = new bottle_stream.WritableBottleStream()
    b.pipe(sink)
    b2 = new bottle_stream.WritableBottleStream()
    promise = b.writeData(b2)
    b2.writeBottleHeader(14, new metadata.Metadata())
    .then ->
      b2.writeEndData()
    .then ->
      b2.close()
    .then ->
      promise
    .then ->
      toolkit.toHex(sink.getBuffer()).should.eql "80e00000"

  it "streams data", future ->
    # just to verify that the data is written as it comes in, and the event isn't triggered until completion.
    data = toolkit.fromHex("ff00")
    slowStream = new stream.Readable()
    slowStream._read = (n) ->
    slowStream.push data
    sink = new toolkit.SinkStream()
    b = new bottle_stream.WritableBottleStream()
    b.pipe(sink)
    b.writeData(slowStream, 4).then ->
      toolkit.toHex(sink.getBuffer()).should.eql "6004ff00ff00"
    Q.delay(100).then ->
      slowStream.push data
      Q.delay(100).then ->
        slowStream.push null

  it "writes several datas", future ->
    data1 = new toolkit.SourceStream(toolkit.fromHex("f0f0f0"))
    data2 = new toolkit.SourceStream(toolkit.fromHex("e0e0e0"))
    data3 = new toolkit.SourceStream(toolkit.fromHex("cccccc"))
    sink = new toolkit.SinkStream()
    b = new bottle_stream.WritableBottleStream()
    b.pipe(sink)
    b.writeData(data1, 3).then ->
      b.writeData(data2, 3)
    .then ->
      b.writeData(data3, 3)
    .then ->
      b.writeEndData()
    .then ->
      toolkit.toHex(sink.getBuffer()).should.eql "0103f0f0f00103e0e0e00103cccccc00"
