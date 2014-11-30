mocha_sprinkles = require "mocha-sprinkles"
toolkit = require "stream-toolkit"
util = require "util"

bottle_stream = require "../lib/4q/lib4q/bottle_stream"
file_bottle = require "../lib/4q/lib4q/file_bottle"
hash_bottle = require "../lib/4q/lib4q/hash_bottle"

future = mocha_sprinkles.future

writeTinyFile = (filename, data) ->
  toolkit.sourceStream(data).pipe(new file_bottle.FileBottleWriter(filename: filename, size: data.length))

readTinyFile = (bottle, filename) ->
  bottle.readPromise().then (fileStream) ->
    bottle_stream.readBottleFromStream(fileStream).then (fileBottle) ->
      fileBottle.type.should.eql bottle_stream.TYPE_FILE
      fileBottle.header.filename.should.eql filename
      fileBottle.readPromise().then (dataStream) ->
        toolkit.pipeToBuffer(dataStream).then (buffer) ->
          { header: fileBottle.header, data: buffer }


describe "HashBottleWriter", ->
  it "writes and hashes a file stream", future ->
    file = writeTinyFile("file.txt", new Buffer("the new pornographers"))
    toolkit.pipeToBuffer(file).then (fileBuffer) ->
      # quick verification that we're hashing what we think we are.
      fileBuffer.toString("hex").should.eql "f09f8dbc0000000d000866696c652e74787480011515746865206e657720706f726e6f677261706865727300ff"
      hashStream = new hash_bottle.HashBottleWriter(hash_bottle.HASH_SHA512)
      toolkit.sourceStream(fileBuffer).pipe(hashStream)
      toolkit.pipeToBuffer(hashStream).then (buffer) ->
        # now decode it.
        bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer))
    .then (bottle) ->
      bottle.type.should.eql bottle_stream.TYPE_HASHED
      bottle.header.hashType.should.eql hash_bottle.HASH_SHA512
      bottle.typeName().should.eql "hashed/SHA-512"
      readTinyFile(bottle, "file.txt").then (file) ->
        file.data.toString().should.eql "the new pornographers"
      .then ->
        bottle.readPromise().then (hashStream) ->
          toolkit.pipeToBuffer(hashStream).then (buffer) ->
            buffer.toString("hex").should.eql "872613ed7e437f332b77ae992925ea33a4565e3f26c9d623da6c78aea9522d90261c4f52824b64f5ad4fdd020a4678c47bf862f53f02a62183749a1e0616b940"

describe "HashBottleReader", ->
  it "reads a hashed stream", future ->
    hashStream = new hash_bottle.HashBottleWriter(hash_bottle.HASH_SHA512)
    writeTinyFile("file.txt", new Buffer("the new pornographers")).pipe(hashStream)
    toolkit.pipeToBuffer(hashStream).then (buffer) ->
      # now decode it.
      bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer))
    .then (bottle) ->
      bottle.type.should.eql bottle_stream.TYPE_HASHED
      bottle.header.hashType.should.eql hash_bottle.HASH_SHA512
      bottle.validate().then ({ bottle, valid }) ->
        bottle.header.filename.should.eql "file.txt"
        bottle.readPromise().then (dataStream) ->
          toolkit.pipeToBuffer(dataStream).then (data) ->
            data.toString().should.eql "the new pornographers"
        .then ->
          bottle.readPromise().then (dataStream) ->
            (dataStream?).should.eql false
        .then ->
          valid.then (valid) ->
            valid.should.eql true
