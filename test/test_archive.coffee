fs = require "fs"
mocha_sprinkles = require "mocha-sprinkles"
Q = require "q"
toolkit = require "stream-toolkit"
util = require "util"

archive = require "../lib/4q/lib4q/archive"

future = mocha_sprinkles.future
withTempFolder = mocha_sprinkles.withTempFolder

archiveWriter = ->
  w = new archive.ArchiveWriter()
  w.collectedEvents = []
  w.on "filename", (filename, stats) -> w.collectedEvents.push { event: "filename", filename, stats }
  w.on "status", (filename, byteCount) -> w.collectedEvents.push { event: "status", filename, byteCount }
  w

archiveReader = ->
  r = new archive.ArchiveReader()
  r.collectedEvents = []
  r.on "start-bottle", (bottle) -> r.collectedEvents.push { event: "start-bottle", bottle }
  r.on "end-bottle", (bottle) -> r.collectedEvents.push { event: "end-bottle", bottle }
  r.on "hash-valid", (isValid) -> r.collectedEvents.push { event: "hash-valid", isValid }
  r.processFile = (dataStream) ->
    toolkit.pipeToBuffer(dataStream).then (data) ->
      r.collectedEvents.push { event: "data", data }
  r


describe "ArchiveWriter", ->
  it "processes a file", future withTempFolder (folder) ->
    fs.writeFileSync("#{folder}/test.txt", "hello")
    w = archiveWriter()
    w.archiveFile("#{folder}/test.txt").then (bottle) ->
      toolkit.pipeToBuffer(bottle).then (data) ->
        data.length.should.eql 78
        w.collectedEvents.filter((e) -> e.event == "filename").map((e) -> e.filename).should.eql [ "test.txt" ]

  it "processes a folder", future withTempFolder (folder) ->
    fs.mkdir("#{folder}/stuff")
    fs.writeFileSync("#{folder}/stuff/one.txt", "one!")
    fs.writeFileSync("#{folder}/stuff/two.txt", "two!")
    w = archiveWriter()
    w.archiveFile("#{folder}/stuff").then (bottle) ->
      toolkit.pipeToBuffer(bottle).then (data) ->
        w.collectedEvents.filter((e) -> e.event == "filename").map((e) -> e.filename).should.eql [ "stuff/", "stuff/one.txt", "stuff/two.txt" ]


describe "ArchiveReader", ->
  it "reads a file", future ->
    data = "f09f8dbc0000003d0008746573742e7478748402a401880800ae4ae2d77e92138c0800ae4ae2d77e9213900800ae4ae2d77e92138001050805726f6265790c05776865656c010568656c6c6f00ff"
    r = archiveReader()
    r.scanStream(new toolkit.SourceStream(new Buffer(data, "hex"))).then ->
      r.collectedEvents.map((e) -> e.event).should.eql [ "start-bottle", "data", "end-bottle" ]
      r.collectedEvents[0].bottle.header.filename.should.eql "test.txt"
      r.collectedEvents[1].data.toString().should.eql "hello"

  it "reads a folder", future ->
    data = "f09f8dbc00000039000573747566668402ed0188080066d7260c8092138c080066d7260c80921390080066d7260c809213c0000805726f6265790c05776865656c014cf09f8dbc0000003c00076f6e652e7478748402a40188080066d7260c8092138c080066d7260c80921390080066d7260c8092138001040805726f6265790c05776865656c01046f6e652100ff00014cf09f8dbc0000003c000774776f2e7478748402a40188080066d7260c8092138c080066d7260c80921390080066d7260c8092138001040805726f6265790c05776865656c010474776f2100ff00ff"
    r = archiveReader()
    r.scanStream(new toolkit.SourceStream(new Buffer(data, "hex"))).then ->
      r.collectedEvents.map((e) -> e.event).should.eql [ "start-bottle", "start-bottle", "data", "end-bottle", "start-bottle", "data", "end-bottle", "end-bottle" ]
      r.collectedEvents[0].bottle.header.filename.should.eql "stuff"
      r.collectedEvents[1].bottle.header.filename.should.eql "one.txt"
      r.collectedEvents[2].data.toString().should.eql "one!"
      r.collectedEvents[4].bottle.header.filename.should.eql "two.txt"
      r.collectedEvents[5].data.toString().should.eql "two!"

