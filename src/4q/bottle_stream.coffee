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

  # write a stream as data. if length == 0, we assume it's a bottle (which has indeterminate length).
  writeData: (inStream, length, final = true) ->
    header = (if length == 0 then 0x80 else 0x40) | (if final then 0x20 else 0)
    @write(new Buffer([ header ])).then =>
      if length == 0 then Q() else @write(zint.encodeZint(length))
    .then =>
      deferred = Q.defer()
      inStream.once "end", =>
        inStream.unpipe(@stream)
        deferred.resolve()
      inStream.pipe(@stream, end: false)
      deferred.promise

  writeEndData: -> @write(new Buffer([ 0 ]))


class Readable4QStream
  constructor: (@stream) ->


exports.MAGIC = MAGIC
exports.Writable4QStream = Writable4QStream
