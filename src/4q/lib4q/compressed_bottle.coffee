bottle_header = require "./bottle_header"
bottle_stream = require "./bottle_stream"
Q = require "q"
snappy = require "snappy"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"
xz = require "xz"

FIELDS =
  NUMBERS:
    COMPRESSION_TYPE: 0

COMPRESSION_LZMA2 = 0
COMPRESSION_SNAPPY = 1

COMPRESSION_NAMES = {}
COMPRESSION_NAMES[COMPRESSION_LZMA2] = "LZMA2"
COMPRESSION_NAMES[COMPRESSION_SNAPPY] = "Snappy"


compressionStreamForType = (compressionType) ->
  switch compressionType
    when COMPRESSION_LZMA2 then new xz.Compressor()
    else throw new Error("Unknown compression stream: #{compressionType}")

compressionTransformForType = (compressionType) ->
  switch compressionType
    when COMPRESSION_SNAPPY then snappy.compress
    else throw new Error("Unknown compression transform: #{compressionType}")

decompressionStreamForType = (compressionType) ->
  switch compressionType
    when COMPRESSION_LZMA2 then new xz.Decompressor()
    when COMPRESSION_SNAPPY then new SnappyDecompressor()
    else throw new Error("Unknown compression type: #{compressionType}")


# Takes a Readable stream (usually a WritableBottleStream) and produces a new
# Readable stream containing the compressed bottle.
class CompressedBottleWriter extends bottle_stream.LoneBottleWriter
  constructor: (@compressionType) ->
    header = new bottle_header.Header()
    header.addNumber(FIELDS.NUMBERS.COMPRESSION_TYPE, @compressionType)
    super(bottle_stream.TYPE_COMPRESSED, header, objectModeRead: false, objectModeWrite: false)
    # snappy compression has no framing of its own, so it needs to compress
    # each frame as a whole block of its own.
    #   @usesFraming: -> framedStream (with inner compressor) ->
    #   otherwise: -> zStream -> framedStream ->
    @usesFraming = switch @compressionType
      when COMPRESSION_SNAPPY then true
      else false
    if @usesFraming 
      transform = compressionTransformForType(@compressionType)
      @framedStream.innerTransform = (buffers, callback) =>
        transform Buffer.concat(buffers), (error, compressedData) =>
          if error? then return @emit "error", error
          callback([ compressedData ])
    else
      @zStream = compressionStreamForType(@compressionType)
      @_process(@zStream)

  _transform: (data, _, callback) ->
    (if @usesFraming then @framedStream else @zStream).write(data, _, callback)

  _flush: (callback) ->
    s = if @usesFraming then @framedStream else @zStream
    s.end()
    s.on "end", =>
      @_close()
      callback()

  
decodeCompressedHeader = (h) ->
  rv = { }
  for field in h.fields
    switch field.type
      when bottle_header.TYPE_ZINT
        switch field.id
          when FIELDS.NUMBERS.COMPRESSION_TYPE then rv.compressionType = field.number
  if not rv.compressionType? then rv.compressionType = COMPRESSION_LZMA2
  rv.compressionName = COMPRESSION_NAMES[rv.compressionType]
  rv

class CompressedBottleReader extends bottle_stream.BottleReader
  constructor: (header, stream) ->
    super(bottle_stream.TYPE_COMPRESSED, header, stream)

  typeName: ->
    "compressed/#{COMPRESSION_NAMES[@header.compressionType]}"

  decompress: ->
    zStream = decompressionStreamForType(@header.compressionType)
    toolkit.qread(@).then (compressedStream) ->
      compressedStream.pipe(zStream)
      bottle_stream.readBottleFromStream(zStream)


# helpers for snappy: make it streamable for decompression.
# snappy only compresses small buffers at a time, and needs to piggy-back on our own framing.
class SnappyDecompressor extends stream.Transform
  constructor: (options) ->
    super(options)

  _transform: (data, _, callback) ->
    snappy.uncompress data, { asBuffer: true }, (error, uncompressed) =>
      if error? then return @emit "error", error
      @push uncompressed
      callback()


exports.COMPRESSION_LZMA2 = COMPRESSION_LZMA2
exports.COMPRESSION_SNAPPY = COMPRESSION_SNAPPY

exports.CompressedBottleReader = CompressedBottleReader
exports.CompressedBottleWriter = CompressedBottleWriter
exports.decodeCompressedHeader = decodeCompressedHeader
