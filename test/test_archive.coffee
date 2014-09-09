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
