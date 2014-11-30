bottle_header = require "./bottle_header"
framed_stream = require "./framed_stream"
Promise = require "bluebird"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"
zint = require "./zint"

MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ])
VERSION = 0x00

TYPE_FILE = 0
TYPE_HASHED = 1
TYPE_ENCRYPTED = 3
TYPE_COMPRESSED = 4

BOTTLE_END = 0xff


# Converts (Readable) stream objects into a stream of framed data blocks with
# a 4Q bottle header/footer. Write Readable streams, read buffers.
class BottleWriter extends stream.Transform
  constructor: (type, header, options = {}) ->
    super(options)
    toolkit.promisify(@)
    @_writableState.objectMode = if options.objectModeWrite? then options.objectModeWrite else true
    @_readableState.objectMode = if options.objectModeRead? then options.objectModeRead else false
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
    .catch (error) ->
      callback(error)

  # write a data stream into this bottle.
  # ("subclasses" may use this to handle their own magic)
  _process: (inStream) ->
    framedStream = framed_stream.writableFramedStream()
    framedStream.on "data", (data) => @push data
    inStream.pipe(framedStream)
    framedStream.endPromise()

  _flush: (callback) ->
    @_close()
    callback()

  _close: ->
    @push new Buffer([ BOTTLE_END ])


# Converts a Readable stream into a framed data stream with a 4Q bottle
# header/footer. Write buffers, read buffers. This is a convenience version
# of BottleWriter for the case (like a compression stream) where there will
# be exactly one nested bottle.
class LoneBottleWriter extends BottleWriter
  constructor: (type, header, options = {}) ->
    if not options.objectModeRead? then options.objectModeRead = false
    if not options.objectModeWrite? then options.objectModeWrite = false
    super(type, header, options)
    # make a single framed stream that we channel
    @framedStream = framed_stream.writableFramedStream()
    @framedStream.on "data", (data) => @push data

  _transform: (data, _, callback) ->
    @framedStream.write(data, _, callback)

  _flush: (callback) ->
    @framedStream.end()
    @framedStream.on "end", =>
      @_close()
      callback()


# read a bottle from a stream, returning a BottleReader object, which is
# a stream that provides sub-streams.
readBottleFromStream = (stream) ->
  # avoid import loops.
  file_bottle = require "./file_bottle"
  hash_bottle = require "./hash_bottle"
  encrypted_bottle = require "./encrypted_bottle"
  compressed_bottle = require "./compressed_bottle"

  readBottleHeader(stream).then ({ type, header, buffer }) ->
    switch type
      when TYPE_FILE
        new BottleReader(type, file_bottle.decodeFileHeader(header), stream)
      when TYPE_HASHED
        new hash_bottle.HashBottleReader(hash_bottle.decodeHashHeader(header), stream)
      when TYPE_ENCRYPTED
        new encrypted_bottle.EncryptedBottleReader(encrypted_bottle.decodeEncryptionHeader(header), stream)
      when TYPE_COMPRESSED
        new compressed_bottle.CompressedBottleReader(compressed_bottle.decodeCompressedHeader(header), stream)
      else
        new BottleReader(type, header, stream)

readBottleHeader = (stream) ->
  stream.readPromise(8).then (buffer) ->
    if not buffer? then throw new Error("End of stream")
    [0 ... 4].map (i) =>
      if buffer[i] != MAGIC[i] then throw new Error("Incorrect magic (not a 4Q archive)")
    if buffer[4] != VERSION then throw new Error("Incompatible version: #{buffer[4].toString(16)}")
    if buffer[5] != 0 then throw new Error("Incompatible flags: #{buffer[5].toString(16)}")
    type = (buffer[6] >> 4) & 0xf
    headerLength = ((buffer[6] & 0xf) * 256) + (buffer[7] & 0xff)
    stream.readPromise(headerLength).then (headerBuffer) =>
      { type, header: bottle_header.unpack(headerBuffer) }


# stream that reads an underlying (buffer) stream, pulls out the header and
# type, and generates data streams.
class BottleReader extends stream.Readable
  constructor: (@type, @header, @stream) ->
    super(objectMode: true)
    @lastPromise = Promise.resolve()
    toolkit.promisify(@)

  # usually subclasses will override this.
  typeName: ->
    switch @type
      when TYPE_FILE
        if @header.folder then "folder" else "file"
      else "unknown(#{@type})"

  _read: (size) ->
    @_nextStream()

  _nextStream: ->
    # must finish reading the last thing we generated, if any:
    @lastPromise.then =>
      @_readDataStream()
    .then (stream) =>
      if not stream? then return @push null
      @lastPromise = stream.endPromise()
      @push stream
    .catch (error) =>
      @emit "error", error

  _readDataStream: ->
    @stream.readPromise(1).then (buffer) =>
      if (not buffer?) or (buffer[0] == BOTTLE_END) then return null
      # put it back. it's part of a data stream!
      @stream.unshift buffer
      framed_stream.readableFramedStream(@stream)


exports.BottleReader = BottleReader
exports.BottleWriter = BottleWriter
exports.LoneBottleWriter = LoneBottleWriter
exports.MAGIC = MAGIC
exports.readBottleFromStream = readBottleFromStream
exports.TYPE_FILE = TYPE_FILE
exports.TYPE_HASHED = TYPE_HASHED
exports.TYPE_ENCRYPTED = TYPE_ENCRYPTED
exports.TYPE_COMPRESSED = TYPE_COMPRESSED
