fs = require "fs"
mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
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

  it "writes a nested folder correctly", future ->
    sink = new toolkit.SinkStream()
    folderStream1 = file_bottle.writeFileBottle(filename: "outer", folder: true )
    folderStream2 = file_bottle.writeFileBottle(filename: "inner", folder: true )
    fileStream = file_bottle.writeFileBottle({ filename: "test.txt", size: 3 }, new toolkit.SourceStream("abc"))
    # wire it up!
    Q.all([
      toolkit.qpipe(folderStream1, sink, end: false).then ->
      folderStream1.writeData(folderStream2).then ->
        folderStream1.close()
      folderStream2.writeData(fileStream).then ->
        folderStream2.close()
    ]).then ->
      toolkit.toHex(sink.getBuffer()).should.eql "f09f8dbc0000000900056f75746572c00080f09f8dbc000000090005696e6e6572c00080f09f8dbc0000000d0008746573742e7478748001030103616263000000"
      # f09f8dbc 00000009
      #   0005 6f75746572  // "outer"
      #   c000             // folder
      #   80
      #     f09f8dbc 00000009
      #     0005 696e6e6572  // "inner"
      #     c000             // folder
      #     80
      #       f09f8dbc 0000000d
      #       0008 746573742e747874  // "test.txt"
      #       800103                 // size=3
      #       01 03
      #         616263
      #       00
      #     00
      #   00
