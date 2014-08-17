file_bottle = require "./file_bottle"
bottle_header = require "./bottle_header"
Q = require "q"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"
zint = require "./zint"

MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ])
VERSION = 0x00

TYPE_FILE = 0

class WritableBottle extends toolkit.QStream
  constructor: (type, header) ->
    super()
    @_writeHeader(type, header)

  _writeHeader: (type, header) ->
    if type < 0 or type > 15 then throw new Error("Bottle type out of range: #{type}")
    buffers = header.pack()
    length = if buffers.length == 0 then 0 else buffers.map((b) -> b.length).reduce((a, b) -> a + b)
    if length > 4095 then throw new Error("Header too long: #{length} > 4095")
    buffers.unshift new Buffer([
      VERSION
      0
      (type << 4) | ((length >> 8) & 0xf)
      (length & 0xff)
    ])
    buffers.unshift MAGIC
    @write(Buffer.concat(buffers))

  # write a stream into the bottle.
  # if it's a WritableBottle, then we write a nested bottle. otherwise, it's treated as data.
  writeData: (inStream, length = 0) ->
    if inStream instanceof WritableBottle
      @write(new Buffer([ 0x80 ])).then =>
        @spliceFrom(inStream)
    else
      header = 0
      lengthBytes = zint.encodePackedInt(length)
      if lengthBytes.length > 7 then throw new Error("wtf")
      header |= lengthBytes.length
      @write(new Buffer([ header ])).then =>
        if lengthBytes? then @write(lengthBytes) else Q()
      .then =>
        @spliceFrom(new toolkit.LimitStream(inStream, length))

  close: ->
    promise = @write(new Buffer([ 0 ]))
    WritableBottle.__super__.close.apply(@)
    promise


# stream that reads an underlying (buffer) stream, pulls out the header and
# type, and generates data objects.
class ReadableBottle extends stream.Readable
  constructor: (@stream) ->
    super(objectMode: true)
    @type = null
    @header = null
    @readingHeaderPromise = @_readHeader()
    @lastPromise = @readingHeaderPromise

  getType: ->
    @readingHeaderPromise.then =>
      @type

  getHeader: ->
    @readingHeaderPromise.then =>
      @header

  _readHeader: ->
    toolkit.qread(@stream, 8).then (buffer) =>
      [0 ... 4].map (i) =>
        if buffer[i] != MAGIC[i] then throw new Error("Incorrect magic")
      if buffer[4] != VERSION then throw new Error("Incompatible version: #{buffer[4].toString(16)}")
      if buffer[5] != 0 then throw new Error("Incompatible flags: #{buffer[5].toString(16)}")
      type = (buffer[6] >> 4) & 0xf
      headerLength = ((buffer[6] & 0xf) * 256) + (buffer[7] & 0xff)
      toolkit.qread(@stream, headerLength).then (b) =>
        @type = type
        @header = bottle_header.unpack(b)
        @_decodeHeader()

  _decodeHeader: ->
    switch @type
      when TYPE_FILE then @header = file_bottle.decodeFileHeader(@header)

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
      # for convenience, add the type & header, since we know them by now
      stream.type = @type
      stream.header = @header
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
exports.TYPE_FILE = TYPE_FILE
exports.WritableBottle = WritableBottle
