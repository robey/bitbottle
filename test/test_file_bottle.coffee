fs = require "fs"
mocha_sprinkles = require "mocha-sprinkles"
toolkit = require "stream-toolkit"
util = require "util"

bottle_stream = require "../lib/4q/bottle_stream"
file_bottle = require "../lib/4q/file_bottle"

future = mocha_sprinkles.future
withTempFolder = mocha_sprinkles.withTempFolder

describe "writeFileBottle", ->
  it "writes and decodes from data", future ->
    stats = 
      filename: "bogus.txt"
      mode: 7
      size: 10
      createdNanos: 1234567890
      username: "tyrion"
    s = file_bottle.writeFileBottle(stats, new toolkit.SourceStream("television"))
    sink = new toolkit.SinkStream()
    toolkit.qpipe(s, sink).then ->
      # now decode it.
      bottle = new bottle_stream.ReadableBottle(new toolkit.SourceStream(sink.getBuffer()))
      toolkit.qread(bottle)

  it "writes and decodes an actual file", future withTempFolder (folder) ->
    fs.writeFileSync("#{folder}/test.txt", "hello!\n")
    file_bottle.writeFileBottleFromFile("#{folder}/test.txt").then (s) ->
      sink = new toolkit.SinkStream()
      toolkit.qpipe(s, sink).then ->
        # now decode it.
        bottle = new bottle_stream.ReadableBottle(new toolkit.SourceStream(sink.getBuffer()))
        toolkit.qread(bottle)
    .then (fileStream) ->
      fileStream.type.should.eql bottle_stream.TYPE_FILE
      fileStream.header.filename.should.eql "#{folder}/test.txt"
      fileStream.header.folder.should.eql false
      fileStream.header.size.should.eql 7
      sink = new toolkit.SinkStream()
      toolkit.qpipe(fileStream, sink).then ->
        sink.getBuffer().toString().should.eql "hello!\n"
