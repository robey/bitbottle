fs = require "fs"
mocha_sprinkles = require "mocha-sprinkles"
toolkit = require "stream-toolkit"
util = require "util"

bottle_stream = require "../lib/4q/lib4q/bottle_stream"
file_bottle = require "../lib/4q/lib4q/file_bottle"

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
      bottle_stream.readBottleFromStream(new toolkit.SourceStream(sink.getBuffer())).then (bottle) ->
        bottle.type.should.eql bottle_stream.TYPE_FILE
        bottle.header.filename.should.eql "bogus.txt"
        bottle.header.mode.should.eql 7
        bottle.header.createdNanos.should.eql 1234567890
        bottle.header.size.should.eql 10
        bottle.header.username.should.eql "tyrion"
        toolkit.qread(bottle).then (fileStream) ->
          sink = new toolkit.SinkStream()
          toolkit.qpipe(fileStream, sink).then ->
            sink.getBuffer().toString().should.eql "television"

  it "writes and decodes an actual file", future withTempFolder (folder) ->
    fs.writeFileSync("#{folder}/test.txt", "hello!\n")
    file_bottle.writeFileBottleFromFile("#{folder}/test.txt").then (s) ->
      sink = new toolkit.SinkStream()
      toolkit.qpipe(s, sink).then ->
        # now decode it.
        bottle_stream.readBottleFromStream(new toolkit.SourceStream(sink.getBuffer())).then (bottle) ->
          bottle.type.should.eql bottle_stream.TYPE_FILE
          bottle.header.filename.should.eql "#{folder}/test.txt"
          bottle.header.folder.should.eql false
          bottle.header.size.should.eql 7
          toolkit.qread(bottle).then (fileStream) ->
            sink = new toolkit.SinkStream()
            toolkit.qpipe(fileStream, sink).then ->
              sink.getBuffer().toString().should.eql "hello!\n"
