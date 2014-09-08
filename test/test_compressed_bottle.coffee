mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
toolkit = require "stream-toolkit"
util = require "util"

bottle_stream = require "../lib/4q/lib4q/bottle_stream"
file_bottle = require "../lib/4q/lib4q/file_bottle"
compressed_bottle = require "../lib/4q/lib4q/compressed_bottle"

future = mocha_sprinkles.future

writeTinyFile = (filename, data) ->
  new toolkit.SourceStream(data).pipe(new file_bottle.FileBottleWriter(filename: filename, size: data.length))

validateTinyFile = (fileBottle, filename) ->
  fileBottle.type.should.eql bottle_stream.TYPE_FILE
  fileBottle.header.filename.should.eql filename
  toolkit.qread(fileBottle).then (dataStream) ->
    toolkit.pipeToBuffer(dataStream).then (buffer) ->
      { header: fileBottle.header, data: buffer }


describe "CompressedBottleWriter", ->
  it "compresses a file stream", future ->
    file = writeTinyFile("file.txt", new Buffer("the new pornographers"))
    toolkit.pipeToBuffer(file).then (fileBuffer) ->
      # quick verification that we're hashing what we think we are.
      fileBuffer.toString("hex").should.eql "f09f8dbc0000000d000866696c652e7478748001150115746865206e657720706f726e6f677261706865727300ff"
      x = new compressed_bottle.CompressedBottleWriter(compressed_bottle.COMPRESSION_LZMA2)
      new toolkit.SourceStream(fileBuffer).pipe(x)
      toolkit.pipeToBuffer(x).then (buffer) ->
        # now decode it.
        bottle_stream.readBottleFromStream(new toolkit.SourceStream(buffer))
    .then (zbottle) ->
      zbottle.type.should.eql bottle_stream.TYPE_COMPRESSED
      zbottle.header.compressionType.should.eql compressed_bottle.COMPRESSION_LZMA2
      compressed_bottle.readCompressedBottle(zbottle).then (bottle) ->
        validateTinyFile(bottle, "file.txt").then ({ header, data }) ->
          data.toString().should.eql "the new pornographers"
