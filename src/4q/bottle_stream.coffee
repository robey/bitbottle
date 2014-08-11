Q = require "q"
metadata = require "./metadata"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"
zint = require "./zint"

MAGIC = new Buffer(8)
MAGIC.writeUInt32BE(0xf09f8dbc, 0)
MAGIC.writeUInt32BE(0, 4)

TYPE_FILE = 0
TYPE_MAGIC = 15

class WritableBottleStream extends toolkit.QStream
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
  writeData: (inStream, length = 0, final = true) ->
    header = 0
    lengthBytes = null
    if length > 0
      if not final then header |= 0x40
      lengthBytes = zint.encodePackedInt(length)
      if lengthBytes.length > 7 then throw new Error("wtf")
      header |= lengthBytes.length
    else
      header = 0x80
    @write(new Buffer([ header ])).then =>
      if lengthBytes? then @write(lengthBytes) else Q()
    .then =>
      if length > 0
        @spliceFrom(new toolkit.LimitStream(inStream, length))
      else
        @spliceFrom(inStream)

  writeEndData: -> @write(new Buffer([ 0 ]))


class ReadableBottleStream
  constructor: (@stream, @hasMagic = false) ->
    @buffered = null
    @active = true
    @savedError = null
    @waiting = null
    @stream.once "end", => @active = false

  readBottle: ->
    return null unless @active
    (if @masMagic then @readMagic() else Q()).then =>
      @readHeader()

  readNextData: ->
    @readDataChunk().then (chunk) =>
      if (not chunk?) or chunk.isBottle then return chunk
      streamQ = [ chunk.stream ]
      keepReading = chunk.keepReading
      generator = =>
        if streamQ.length > 0 then return streamQ.shift()
        if not keepReading then return null
        @readDataChunk().then (chunk) =>
          keepReading = chunk.keepReading
          chunk.stream
      { isBottle: chunk.isBottle, stream: new toolkit.CompoundStream(generator) }

  readMagic: ->
    toolkit.qread(@stream, MAGIC.length).then (buffer) =>
      if buffer != MAGIC then throw new Error("Invalid magic header")

  readHeader: ->
    toolkit.qread(@stream, 2).then (buffer) =>
      type = (buffer[0] >> 4) & 0xf
      metadataLength = ((buffer[0] & 0xf) * 256) + (buffer[1] & 0xff)
      toolkit.qread(@stream, metadataLength).then (b) =>
        { type, metadata: metadata.unpack(b) }

  readDataChunk: ->
    toolkit.qread(@stream, 1).then (buffer) =>
      if buffer[0] == 0 then return null
      isBottle = (buffer[0] & 0x80) > 0
      if isBottle then return { isBottle, stream: @stream }
      keepReading = (buffer[0] & 0x40) > 0
      lengthBytes = (buffer[0] & 7)
      toolkit.qread(@stream, lengthBytes).then (buffer) =>
        length = zint.decodePackedInt(buffer)
        { isBottle, keepReading, stream: new toolkit.LimitStream(@stream, length) }


exports.MAGIC = MAGIC
exports.ReadableBottleStream = ReadableBottleStream
exports.WritableBottleStream = WritableBottleStream
