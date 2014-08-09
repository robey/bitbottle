Q = require "q"
metadata = require "./metadata"
push_stream = require "./push_stream"
stream = require "stream"
util = require "util"
zint = require "./zint"

MAGIC = new Buffer(8)
MAGIC.writeUInt32BE(0xf09f8dbc, 0)
MAGIC.writeUInt32BE(0, 4)

TYPE_FILE = 0
TYPE_MAGIC = 15

class WritableBottleStream extends push_stream.PushStream
  constructor: ->
    super()

  writeMagic: ->
    @write MAGIC

  writeBottleHeader: (type, metadata) ->
    # bottle header: TTTTLLLL LLLLLLLL (T = type, L = metadata length)
    if type < 0 or type > 15 then throw new Error("Bottle type out of range: #{type}")
    buffers = metadata.pack()
    length = if buffers.length == 0 then 0 else buffers.map((b) -> b.length).reduce((a, b) -> a + b)
    if length > 4095 then throw new Error("Metadata too long: #{metadataBuffer.length} > 4095")
    buffers.unshift new Buffer([ (type << 4) | ((length >> 8) & 0xf), (length & 0xff) ])
    @write(Buffer.concat(buffers))

  # write a stream as data. if length == 0, we assume it's a bottle (which has indeterminate length).
  writeData: (inStream, length, final = true) ->
    header = (if length? then 0x40 else 0x80) | (if final then 0x20 else 0)
    @write(new Buffer([ header ])).then =>
      if length? then @write(zint.encodeZint(length)) else Q()
    .then =>
      @spliceFrom(inStream, length)

  writeEndData: -> @write(new Buffer([ 0 ]))


class Readable4QStream
  constructor: (@stream) ->


exports.MAGIC = MAGIC
exports.Writable4QStream = Writable4QStream
