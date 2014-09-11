bottle_header = require "./bottle_header"
bottle_stream = require "./bottle_stream"
Q = require "q"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"
xz = require "xz"

FIELDS =
  NUMBERS:
    COMPRESSION_TYPE: 0

COMPRESSION_LZMA2 = 0

COMPRESSION_NAMES = {}
COMPRESSION_NAMES[COMPRESSION_LZMA2] = "LZMA2"


compressionStreamForType = (compressionType) ->
  switch compressionType
    when COMPRESSION_LZMA2 then new xz.Compressor()
    else throw new Error("Unknown compression type: #{compressionType}")

decompressionStreamForType = (compressionType) ->
  switch compressionType
    when COMPRESSION_LZMA2 then new xz.Decompressor()
    else throw new Error("Unknown compression type: #{compressionType}")


# Takes a Readable stream (usually a WritableBottleStream) and produces a new
# Readable stream containing the compressed bottle.
class CompressedBottleWriter extends bottle_stream.LoneBottleWriter
  constructor: (@compressionType) ->
    header = new bottle_header.Header()
    header.addNumber(FIELDS.NUMBERS.COMPRESSION_TYPE, @compressionType)
    super(bottle_stream.TYPE_COMPRESSED, header, objectModeRead: false, objectModeWrite: false)
    @zStream = compressionStreamForType(@compressionType)
    @_process(@zStream)

  _transform: (data, _, callback) ->
    @zStream.write(data, _, callback)

  _flush: (callback) ->
    @zStream.end()
    @zStream.on "end", =>
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


exports.decodeCompressedHeader = decodeCompressedHeader
exports.COMPRESSION_LZMA2 = COMPRESSION_LZMA2
exports.CompressedBottleReader = CompressedBottleReader
exports.CompressedBottleWriter = CompressedBottleWriter
