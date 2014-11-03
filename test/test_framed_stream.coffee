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
      data.toString("hex").should.eql "0301020300"

  it "buffers up a frame", future ->
    s = new framed_stream.WritableFramedStream()
    promise = toolkit.pipeToBuffer(s)
    s.write(new Buffer("he"))
    s.write(new Buffer("ll"))
    s.write(new Buffer("o sai"))
    s.write(new Buffer("lor"))
    s.end()
    promise.then (data) ->
      data.toString("hex").should.eql "0c68656c6c6f207361696c6f7200"

  it "flushes when it reaches the block size", future ->
    s = new framed_stream.WritableFramedStream(blockSize: 3)
    promise = toolkit.pipeToBuffer(s)
    s.write(new Buffer("he"))
    s.write(new Buffer("ll"))
    s.write(new Buffer("o sai"))
    s.write(new Buffer("lor"))
    s.end()
    promise.then (data) ->
      data.toString("hex").should.eql "0468656c6c056f20736169036c6f7200"

  it "writes a power-of-two frame", future ->
    Q.all([ 128, 1024, Math.pow(2, 18), Math.pow(2, 22) ].map (blockSize) ->
      s = new framed_stream.WritableFramedStream()
      promise = toolkit.pipeToBuffer(s)
      b = new Buffer(blockSize)
      b.fill(0)
      s.write(b)
      s.end()
      promise.then (data) ->
        data.length.should.eql blockSize + 2
        data[0].should.eql (Math.log(blockSize) / Math.log(2)) + 0xf0 - 7
    )

  it "writes a medium (< 8K) frame", future ->
    Q.all([ 129, 1234, 8191 ].map (blockSize) ->
      s = new framed_stream.WritableFramedStream()
      promise = toolkit.pipeToBuffer(s)
      b = new Buffer(blockSize)
      b.fill(0)
      s.write(b)
      s.end()
      promise.then (data) ->
        data.length.should.eql blockSize + 3
        data[0].should.eql (blockSize & 0x3f) + 0x80
        data[1].should.eql (blockSize >> 6)
    )

  it "writes a large (>= 8K) frame", future ->
    Q.all([ 8193, 12345, 456123 ].map (blockSize) ->
      s = new framed_stream.WritableFramedStream()
      promise = toolkit.pipeToBuffer(s)
      b = new Buffer(blockSize)
      b.fill(0)
      s.write(b)
      s.end()
      promise.then (data) ->
        data.length.should.eql blockSize + 4
        data[0].should.eql (blockSize & 0x1f) + 0xc0
        data[1].should.eql (blockSize >> 5) & 0xff
        data[2].should.eql (blockSize >> 13)
    )


describe "ReadableFramedStream", ->
  it "reads a simple frame", ->
    s = new framed_stream.ReadableFramedStream(new toolkit.SourceStream(new Buffer("0301020300", "hex")))
    toolkit.pipeToBuffer(s).then (data) ->
      data.toString("hex").should.eql "010203"

  it "reads a block of many frames", ->
    s = new framed_stream.ReadableFramedStream(new toolkit.SourceStream(new Buffer("0468656c6c056f20736169036c6f7200", "hex")))
    toolkit.pipeToBuffer(s).then (data) ->
      data.toString().should.eql "hello sailor"

  it "can pipe two framed streams from the same source", ->
    source = new toolkit.SourceStream(new Buffer("0568656c6c6f00067361696c6f7200", "hex"))
    toolkit.pipeToBuffer(new framed_stream.ReadableFramedStream(source)).then (data) ->
      data.toString().should.eql "hello"
      toolkit.pipeToBuffer(new framed_stream.ReadableFramedStream(source)).then (data) ->
        data.toString().should.eql "sailor"
