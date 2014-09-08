mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
stream = require "stream"
should = require "should"
toolkit = require "stream-toolkit"
util = require "util"

framed_stream = require "../lib/4q/lib4q/framed_stream"

future = mocha_sprinkles.future


describe "WritableFramedStream", ->
  it "writes a small frame", future ->
    s = new framed_stream.WritableFramedStream()
    promise = toolkit.pipeToBuffer(s)
    s.write(new Buffer([ 1, 2, 3 ]))
    s.end()
    promise.then (data) ->
      data.toString("hex").should.eql "010301020300"

  it "buffers up a frame", future ->
    s = new framed_stream.WritableFramedStream()
    promise = toolkit.pipeToBuffer(s)
    s.write(new Buffer("he"))
    s.write(new Buffer("ll"))
    s.write(new Buffer("o sai"))
    s.write(new Buffer("lor"))
    s.end()
    promise.then (data) ->
      data.toString("hex").should.eql "010c68656c6c6f207361696c6f7200"

  it "flushes when it reaches the block size", future ->
    s = new framed_stream.WritableFramedStream(blockSize: 3)
    promise = toolkit.pipeToBuffer(s)
    s.write(new Buffer("he"))
    s.write(new Buffer("ll"))
    s.write(new Buffer("o sai"))
    s.write(new Buffer("lor"))
    s.end()
    promise.then (data) ->
      data.toString("hex").should.eql "010468656c6c01056f2073616901036c6f7200"


describe "ReadableFramedStream", ->
  it "reads a simple frame", ->
    s = new framed_stream.ReadableFramedStream(new toolkit.SourceStream(new Buffer("010301020300", "hex")))
    toolkit.pipeToBuffer(s).then (data) ->
      data.toString("hex").should.eql "010203"

  it "reads a block of many frames", ->
    s = new framed_stream.ReadableFramedStream(new toolkit.SourceStream(new Buffer("010468656c6c01056f2073616901036c6f7200", "hex")))
    toolkit.pipeToBuffer(s).then (data) ->
      data.toString().should.eql "hello sailor"

  it "can pipe two framed streams from the same source", ->
    source = new toolkit.SourceStream(new Buffer("010568656c6c6f0001067361696c6f7200", "hex"))
    toolkit.pipeToBuffer(new framed_stream.ReadableFramedStream(source)).then (data) ->
      data.toString().should.eql "hello"
      toolkit.pipeToBuffer(new framed_stream.ReadableFramedStream(source)).then (data) ->
        data.toString().should.eql "sailor"
