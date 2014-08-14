Q = require "q"
metadata = require "./metadata"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"
zint = require "./zint"

MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ])
VERSION = 0x00

TYPE_FILE = 0

class WritableBottleStream extends toolkit.QStream
  constructor: ->
    super()

  writeBottleHeader: (type, metadata) ->
    if type < 0 or type > 15 then throw new Error("Bottle type out of range: #{type}")
    buffers = metadata.pack()
    length = if buffers.length == 0 then 0 else buffers.map((b) -> b.length).reduce((a, b) -> a + b)
    if length > 4095 then throw new Error("Metadata too long: #{metadataBuffer.length} > 4095")
    buffers.unshift new Buffer([
      VERSION
      0
      (type << 4) | ((length >> 8) & 0xf)
      (length & 0xff)
    ])
    buffers.unshift MAGIC
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


# stream that reads an underlying (buffer) stream, pulls out the metadata and
# type, and generates data objects.
class ReadableBottle extends stream.Readable
  constructor: (@stream) ->
    super(objectMode: true)
    @type = null
    @metadata = null
    @metadataPromise = @_readHeader()
    @lastPromise = @metadataPromise

  getType: ->
    @metadataPromise.then =>
      @type

  getMetadata: ->
    @metadataPromise.then =>
      @metadata

  _readHeader: ->
    toolkit.qread(@stream, 8).then (buffer) =>
      [0 ... 4].map (i) =>
        if buffer[i] != MAGIC[i] then throw new Error("Incorrect magic header")
      if buffer[4] != VERSION then throw new Error("Incompatible version: #{buffer[4].toString(16)}")
      if buffer[5] != 0 then throw new Error("Incompatible flags: #{buffer[5].toString(16)}")
      type = (buffer[6] >> 4) & 0xf
      metadataLength = ((buffer[6] & 0xf) * 256) + (buffer[7] & 0xff)
      toolkit.qread(@stream, metadataLength).then (b) =>
        @type = type
        @metadata = metadata.unpack(b)

  _read: (size) ->
    # must finish reading the last thing we generated (either the promise for reading the header, or the last data stream):
    @lastPromise.then =>
      @_readDataChunk()
    .then (stream) =>
      if not stream? then return @push null
      if stream instanceof ReadableBottle
        @lastPromise = qend(stream)
        @push stream
        return
      stream = @_streamData(stream)
      @lastPromise = toolkit.qend(stream)
      @push stream

  # keep reading data chunks until the "keepReading" bit is clear.
  _streamData: (firstStream) ->
    streamQ = [ firstStream ]
    currentStream = firstStream
    generator = =>
      if streamQ.length > 0 then return streamQ.shift()
      if not currentStream._keepReading then return null
      @_readDataChunk().then (stream) =>
        currentStream = stream
        stream
    new toolkit.CompoundStream(generator)

  _readDataChunk: ->
    toolkit.qread(@stream, 1).then (buffer) =>
      # end of data stream?
      if buffer[0] == 0 then return null
      isBottle = (buffer[0] & 0x80) != 0
      if isBottle then return new ReadableBottle(@stream)
      keepReading = (buffer[0] & 0x40) != 0
      lengthBytes = (buffer[0] & 7)
      toolkit.qread(@stream, lengthBytes).then (buffer) =>
        length = zint.decodePackedInt(buffer)
        s = new toolkit.LimitStream(@stream, length)
        s._keepReading = keepReading
        s



exports.MAGIC = MAGIC
exports.ReadableBottle = ReadableBottle
exports.WritableBottleStream = WritableBottleStream
