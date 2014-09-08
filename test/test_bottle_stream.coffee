mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
stream = require "stream"
should = require "should"
toolkit = require "stream-toolkit"
util = require "util"

bottle_header = require "../lib/4q/lib4q/bottle_header"
bottle_stream = require "../lib/4q/lib4q/bottle_stream"

future = mocha_sprinkles.future

MAGIC_STRING = "f09f8dbc0000"

shouldQThrow = (promise, message) ->
  promise.then((-> throw new Error("Expected exception, got valid promise")), ((err) -> (-> throw err).should.throw message))


describe "BottleWriter", ->
  it "writes a bottle header", future ->
    m = new bottle_header.Header()
    m.addNumber(0, 150)
    b = new bottle_stream.BottleWriter(10, m)
    b.end()
    toolkit.pipeToBuffer(b).then (data) ->
      data.toString("hex").should.eql "#{MAGIC_STRING}a003800196ff"

  it "writes data", future ->
    data = new toolkit.SourceStream(new Buffer("ff00ff00", "hex"))
    b = new bottle_stream.BottleWriter(10, new bottle_header.Header())
    b.write(data)
    b.end()
    toolkit.pipeToBuffer(b).then (data) ->
      data.toString("hex").should.eql "#{MAGIC_STRING}a0000104ff00ff0000ff"

  it "writes nested bottle data", future ->
    b = new bottle_stream.BottleWriter(10, new bottle_header.Header())
    b2 = new bottle_stream.BottleWriter(14, new bottle_header.Header())
    b.write(b2)
    b.end()
    b2.end()
    toolkit.pipeToBuffer(b).then (data) ->
      data.toString("hex").should.eql "#{MAGIC_STRING}a0000109#{MAGIC_STRING}e000ff00ff"

  it "streams data", future ->
    # just to verify that the data is written as it comes in, and the event isn't triggered until completion.
    data = new Buffer("c44c", "hex")
    slowStream = new stream.Readable()
    slowStream._read = (n) ->
    slowStream.push data
    b = new bottle_stream.BottleWriter(14, new bottle_header.Header())
    Q.delay(100).then ->
      slowStream.push data
      Q.delay(100).then ->
        slowStream.push null
    b.write(slowStream)
    b.end()
    toolkit.pipeToBuffer(b).then (data) ->
      data.toString("hex").should.eql "#{MAGIC_STRING}e0000104c44cc44c00ff"

  it "writes several datas", future ->
    data1 = new toolkit.SourceStream(new Buffer("f0f0f0", "hex"))
    data2 = new toolkit.SourceStream(new Buffer("e0e0e0", "hex"))
    data3 = new toolkit.SourceStream(new Buffer("cccccc", "hex"))
    b = new bottle_stream.BottleWriter(14, new bottle_header.Header())
    b.write(data1)
    b.write(data2)
    b.write(data3)
    b.end()
    toolkit.pipeToBuffer(b).then (data) ->
      data.toString("hex").should.eql "#{MAGIC_STRING}e0000103f0f0f0000103e0e0e0000103cccccc00ff"


describe "ReadableBottle", ->
  BASIC_MAGIC = "f09f8dbc0000e000"

  it "validates the header", future ->
    b = bottle_stream.readBottleFromStream(new toolkit.SourceStream(new Buffer("00", "hex")))
    shouldQThrow b, /magic/
    b = bottle_stream.readBottleFromStream(new toolkit.SourceStream(new Buffer("f09f8dbcff000000", "hex")))
    shouldQThrow b, /version/
    b = bottle_stream.readBottleFromStream(new toolkit.SourceStream(new Buffer("f09f8dbc00ff0000", "hex")))
    shouldQThrow b, /flags/

  it "reads the header", future ->
    bottle_stream.readBottleFromStream(new toolkit.SourceStream(new Buffer("f09f8dbc0000c000", "hex"))).then (b) ->
      b.header.fields.length.should.eql 0
      b.type.should.eql 12
      bottle_stream.readBottleFromStream(new toolkit.SourceStream(new Buffer("f09f8dbc0000e003800196", "hex"))).then (b) ->
        b.header.fields.length.should.eql 1
        b.header.fields[0].number.should.eql 150
        b.type.should.eql 14

  it "reads a data block", future ->
    bottle_stream.readBottleFromStream(new toolkit.SourceStream(new Buffer("#{BASIC_MAGIC}010568656c6c6f00ff", "hex"))).then (b) ->
      toolkit.qread(b).then (dataStream) ->
        toolkit.pipeToBuffer(dataStream).then (data) ->
          data.toString().should.eql "hello"
          toolkit.qread(b).then (dataStream) ->
            (dataStream?).should.eql false

  it "reads a continuing data block", future ->
    bottle_stream.readBottleFromStream(new toolkit.SourceStream(new Buffer("#{BASIC_MAGIC}0102686501016c01026c6f00ff", "hex"))).then (b) ->
      toolkit.qread(b).then (dataStream) ->
        toolkit.pipeToBuffer(dataStream).then (data) ->
          data.toString().should.eql "hello"
          toolkit.qread(b).then (data) ->
            (data?).should.eql false

  it "reads several datas", future ->
    bottle_stream.readBottleFromStream(new toolkit.SourceStream(new Buffer("#{BASIC_MAGIC}0103f0f0f0000103e0e0e0000103cccccc00ff", "hex"))).then (b) ->
      toolkit.qread(b).then (dataStream) ->
        toolkit.pipeToBuffer(dataStream).then (data) ->
          data.toString("hex").should.eql "f0f0f0"
          toolkit.qread(b)
      .then (dataStream) ->
        toolkit.pipeToBuffer(dataStream).then (data) ->
          data.toString("hex").should.eql "e0e0e0"
          toolkit.qread(b)
      .then (dataStream) ->
        toolkit.pipeToBuffer(dataStream).then (data) ->
          data.toString("hex").should.eql "cccccc"
          toolkit.qread(b)
      .then (dataStream) ->
        (dataStream?).should.eql false

  it "reads several bottles from the same stream", future ->
    source = new toolkit.SourceStream(new Buffer("#{BASIC_MAGIC}010363617400ff#{BASIC_MAGIC}010368617400ff", "hex"))
    bottle_stream.readBottleFromStream(source).then (b) ->
      toolkit.qread(b).then (dataStream) ->
        toolkit.pipeToBuffer(dataStream).then (data) ->
          data.toString().should.eql "cat"
          toolkit.qread(b)
      .then (dataStream) ->
        (dataStream?).should.eql false
        bottle_stream.readBottleFromStream(source)
    .then (b) ->
      toolkit.qread(b)
      .then (dataStream) ->
        toolkit.pipeToBuffer(dataStream).then (data) ->
          data.toString().should.eql "hat"
          toolkit.qread(b)
      .then (dataStream) ->
        (dataStream?).should.eql false
        bottle_stream.readBottleFromStream(source)
    .then(((b) -> throw new Error("expected end of stream")), ((err) -> ))
