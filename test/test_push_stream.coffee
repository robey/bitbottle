helpers = require "./helpers"
mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
stream = require "stream"
util = require "util"

push_stream = require "../lib/4q/push_stream"

bufferSink = helpers.bufferSink
bufferSource = helpers.bufferSource
fromHex = helpers.fromHex
future = mocha_sprinkles.future
toHex = helpers.toHex

describe "PushStream", ->
  it "pushes when active", future ->
    sink = bufferSink()
    ps = new push_stream.PushStream()
    promise = ps.qpipe(sink)
    ps.write(new Buffer([ 0x0f ])).then ->
      ps.write(new Buffer([ 0x0d ]))
    .then ->
      ps.close()
    .then ->
      promise
    .then ->
      toHex(sink.getBuffer()).should.eql "0f0d"

  it "drains a full stream", future ->
    sink = bufferSink()
    ps = new push_stream.PushStream()
    promise1 = ps.write(new Buffer([ 0x41 ]))
    promise2 = ps.write(new Buffer([ 0x42 ]))
    ps.close()
    promise = ps.qpipe(sink).then ->
      toHex(sink.getBuffer()).should.eql "4142"

  it "acks only when data is received", future ->
    slowWriter = new stream.Writable()
    slowWriter.buffers = []
    slowWriter._write = (chunk, encoding, callback) ->
      slowWriter.buffers.push { chunk, callback }
    ps = new push_stream.PushStream()
    promise = ps.qpipe(slowWriter)
    flag = 0
    ps.write(new Buffer([ 0x41, 0x42, 0x43 ])).then ->
      flag.should.eql 1
      ps.close()
    Q.delay(10).then ->
      flag = 1
      slowWriter.buffers.length.should.eql 1
      slowWriter.buffers[0].chunk.toString("UTF-8").should.eql "ABC"
      slowWriter.buffers[0].callback()

  it "splices in another stream", future ->
    slowReader = new stream.Readable()
    slowReader._read = (n) ->
    ps = new push_stream.PushStream()
    ps.write(new Buffer([ 0x41 ]))
    flag = 0
    x = ps.spliceFrom(slowReader).then ->
      flag.should.eql 1
      ps.write(new Buffer([ 0x42 ])).then ->
        ps.close()
    Q.delay(10).then ->
      flag += 1
      slowReader.push new Buffer([ 0x49 ])
      slowReader.push null
    sink = bufferSink()
    ps.qpipe(sink).then ->
      toHex(sink.getBuffer()).should.eql "414942"
    x
