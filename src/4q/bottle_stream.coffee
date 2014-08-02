Q = require 'q'
util = require "util"
zint = require "./zint"

MAGIC = new Buffer(8)
MAGIC.writeUInt32BE(0xf09f8dbc, 0)
MAGIC.writeUInt32BE(0, 4)

class Writable4QStream
  constructor: (@stream) ->

  write: (buffer) ->
    deferred = Q.defer()
    @stream.write buffer, ->
      deferred.resolve()
    deferred.promise

  writeMagic: ->
    @write(MAGIC)

  writeBottleHeader: (type, metadata) ->
    # bottle header: TTTTLLLL LLLLLLLL (T = type, L = metadata length)
    if type < 0 or type > 15 then throw new Error("Bottle type out of range: #{type}")
    buffers = metadata.pack()
    length = buffers.map((b) -> b.length).reduce((a, b) -> a + b)
    if length > 4095 then throw new Error("Metadata too long: #{metadataBuffer.length} > 4095")
    buffers.unshift new Buffer([ (type << 4) | ((length >> 8) & 0xf), (length & 0xff) ])
    @write(Buffer.concat(buffers))

  writeData: (length, inStream) ->
    @write(zint.encodeZint(length)).then =>
      deferred = Q.defer()
      inStream.once "end", -> deferred.resolve()
      inStream.pipe(@stream, end: false)
      deferred.promise


class Readable4QStream
  constructor: (@stream) ->


exports.MAGIC = MAGIC
exports.Writable4QStream = Writable4QStream
