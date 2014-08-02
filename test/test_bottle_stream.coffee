mocha_sprinkles = require "mocha-sprinkles"
stream = require "stream"
should = require "should"
util = require "util"

bottle_stream = require "../lib/4q/bottle_stream"
future = mocha_sprinkles.future

bufferSink = ->
  s = new stream.Writable()
  s.buffers = []
  s._write = (chunk, encoding, callback) ->
    s.buffers.push chunk
    callback(null)
  s.getBuffer = -> Buffer.concat(s.buffers)
  s


describe "Writable4QStream", ->
  it "writes magic", future ->
    sink = bufferSink()
    b = new bottle_stream.Writable4QStream(sink)
    b.writeMagic().then ->
      sink.getBuffer().should.eql bottle_stream.MAGIC
