fs = require "fs"
mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
toolkit = require "stream-toolkit"
util = require "util"

bottle_stream = require "../lib/4q/lib4q/bottle_stream"
file_bottle = require "../lib/4q/lib4q/file_bottle"

future = mocha_sprinkles.future
withTempFolder = mocha_sprinkles.withTempFolder

describe "FileBottleWriter", ->
  it "writes and decodes from data", future ->
    header = 
      filename: "bogus.txt"
      mode: 7
      size: 10
      createdNanos: 1234567890
      username: "tyrion"
    bottle = new file_bottle.FileBottleWriter(header)
    new toolkit.SourceStream("television").pipe(bottle)
    toolkit.pipeToBuffer(bottle).then (data) ->
      # now decode it.
      bottle_stream.readBottleFromStream(new toolkit.SourceStream(data)).then (bottle) ->
        bottle.type.should.eql bottle_stream.TYPE_FILE
        bottle.header.filename.should.eql "bogus.txt"
        bottle.header.mode.should.eql 7
        bottle.header.createdNanos.should.eql 1234567890
        bottle.header.size.should.eql 10
        bottle.header.username.should.eql "tyrion"
        toolkit.qread(bottle).then (fileStream) ->
          toolkit.pipeToBuffer(fileStream).then (data) ->
            data.toString().should.eql "television"

  it "writes and decodes an actual file", future withTempFolder (folder) ->
    filename = "#{folder}/test.txt"
    fs.writeFileSync(filename, "hello!\n")
    stats = fs.statSync(filename)
    bottle = new file_bottle.FileBottleWriter(file_bottle.fileHeaderFromStats(filename, stats))
    fs.createReadStream(filename).pipe(bottle)
    toolkit.pipeToBuffer(bottle).then (data) ->
      # now decode it.
      bottle_stream.readBottleFromStream(new toolkit.SourceStream(data)).then (bottle) ->
        bottle.type.should.eql bottle_stream.TYPE_FILE
        bottle.header.filename.should.eql "#{folder}/test.txt"
        bottle.header.folder.should.eql false
        bottle.header.size.should.eql 7
        toolkit.qread(bottle).then (fileStream) ->
          toolkit.pipeToBuffer(fileStream).then (data) ->
            data.toString().should.eql "hello!\n"

  it "writes a nested folder correctly", future ->
    bottle1 = new file_bottle.FolderBottleWriter(filename: "outer", folder: true)
    bottle2 = new file_bottle.FolderBottleWriter(filename: "inner", folder: true)
    bottle3 = new file_bottle.FileBottleWriter(filename: "test.txt", size: 3)
    new toolkit.SourceStream("abc").pipe(bottle3)
    # wire it up!
    bottle1.write(bottle2)
    bottle1.end()
    bottle2.write(bottle3)
    bottle2.end()
    toolkit.pipeToBuffer(bottle1).then (data) ->
      data.toString("hex").should.eql "f09f8dbc0000000900056f75746572c0000131f09f8dbc000000090005696e6e6572c000011cf09f8dbc0000000d0008746573742e747874800103010361626300ff00ff00ff"
      # f09f8dbc 00000009
      #   0005 6f75746572  // "outer"
      #   c000             // folder
      #   01 31
      #     f09f8dbc 00000009
      #     0005 696e6e6572  // "inner"
      #     c000             // folder
      #     01 1c
      #       f09f8dbc 0000000d
      #       0008 746573742e747874  // "test.txt"
      #       800103                 // size=3
      #       01 03
      #         616263
      #       00 ff
      #     00 ff
      #   00 ff
