bottle_header = require "./bottle_header"
framed_stream = require "./framed_stream"
Q = require "q"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"
zint = require "./zint"

MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ])
VERSION = 0x00

TYPE_FILE = 0
TYPE_HASHED = 1

BOTTLE_END = 0xff


# Converts (Readable) stream objects into a stream of framed data blocks with
# a 4Q bottle header/footer. Write Readable streams, read buffers.
class BottleWriter extends stream.Transform
  constructor: (type, header) ->
    super()
    @_writableState.objectMode = true
    @_readableState.objectMode = false
    @_writeHeader(type, header)

  _writeHeader: (type, header) ->
    if type < 0 or type > 15 then throw new Error("Bottle type out of range: #{type}")
    buffers = header.pack()
    length = if buffers.length == 0 then 0 else buffers.map((b) -> b.length).reduce((a, b) -> a + b)
    if length > 4095 then throw new Error("Header too long: #{length} > 4095")
    @push MAGIC
    @push new Buffer([
      VERSION
      0
      (type << 4) | ((length >> 8) & 0xf)
      (length & 0xff)
    ])
    buffers.map (b) => @push b

  _transform: (inStream, _, callback) ->
    @_process(inStream).then ->
      callback()
    .fail (error) ->
      callback(error)

  # write a data stream into this bottle.
  # ("subclasses" may use this to handle their own magic)
  _process: (inStream) ->
    framedStream = new framed_stream.WritableFramedStream()
    inStream.pipe(framedStream)
    # create a small transform to pipe framedStream back into meeeee
    plumbing = new stream.Transform()
    plumbing._transform = (data, _, cb) =>
      @push data
      cb()
    toolkit.qpipe(framedStream, plumbing)

  _flush: (callback) ->
    @push new Buffer([ BOTTLE_END ])
    callback()


# read a bottle from a stream, returning a "ReadableBottle" object, which is
# a stream that provides sub-streams.
readBottleFromStream = (stream) ->
  # avoid import loops.
  file_bottle = require "./file_bottle"
  hash_bottle = require "./hash_bottle"

  readBottleHeader(stream).then ({ type, header, buffer }) ->
    header = switch type
      when TYPE_FILE then file_bottle.decodeFileHeader(header)
      when TYPE_HASHED then hash_bottle.decodeHashHeader(header)
      else header
    new ReadableBottle(type, header, buffer, stream)

readBottleHeader = (stream) ->
  toolkit.qread(stream, 8).then (buffer) ->
    if not buffer? then throw new Error("End of stream")
    [0 ... 4].map (i) =>
      if buffer[i] != MAGIC[i] then throw new Error("Incorrect magic (not a 4Q archive)")
    if buffer[4] != VERSION then throw new Error("Incompatible version: #{buffer[4].toString(16)}")
    if buffer[5] != 0 then throw new Error("Incompatible flags: #{buffer[5].toString(16)}")
    type = (buffer[6] >> 4) & 0xf
    headerLength = ((buffer[6] & 0xf) * 256) + (buffer[7] & 0xff)
    toolkit.qread(stream, headerLength).then (headerBuffer) =>
      { type, header: bottle_header.unpack(headerBuffer) }


# stream that reads an underlying (buffer) stream, pulls out the header and
# type, and generates data streams.
class ReadableBottle extends stream.Readable
  constructor: (@type, @header, @headerBuffer, @stream) ->
    super(objectMode: true)
    @lastPromise = Q()

  _read: (size) ->
    @_nextStream()

  _nextStream: ->
    # must finish reading the last thing we generated, if any:
    @lastPromise.then =>
      @_readDataStream()
    .then (stream) =>
      if not stream? then return @push null
      @lastPromise = toolkit.qend(stream)
      @push stream
    .fail (error) =>
      @emit "error", error

  _readDataStream: ->
    toolkit.qread(@stream, 1).then (buffer) =>
      if (not buffer?) or (buffer[0] == BOTTLE_END) then return null
      # put it back. it's part of a data stream!
      @stream.unshift buffer
      new framed_stream.ReadableFramedStream(@stream)


exports.BottleWriter = BottleWriter
exports.MAGIC = MAGIC
exports.ReadableBottle = ReadableBottle
exports.readBottleFromStream = readBottleFromStream
exports.TYPE_FILE = TYPE_FILE
exports.TYPE_HASHED = TYPE_HASHED
