Q = require "q"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"
zint = require "./zint"

DEFAULT_BLOCK_SIZE = Math.pow(2, 20)  # 1MB


# transform that buffers data until it reaches a desired block size, then
# adds a framing header for the block.
class WritableFramedStream extends stream.Transform
  constructor: (options) ->
    super(options)
    @blockSize = options?.blockSize or DEFAULT_BLOCK_SIZE
    @buffer = []
    @bufferSize = 0

  _transform: (data, _, callback) ->
    @buffer.push data
    @bufferSize += data.length
    if @bufferSize >= @blockSize then @_drain()
    callback()

  _flush: (callback) ->
    @_drain()
    @push new Buffer([ 0 ])
    callback()

  _drain: () ->
    return if @bufferSize == 0
    lengthBytes = zint.encodePackedInt(@bufferSize)
    if lengthBytes.length > 7 then throw new Error("wtf")
    @push new Buffer([ lengthBytes.length ])
    @push lengthBytes
    @buffer.map (d) => @push d
    @buffer = []
    @bufferSize = 0


# wrap a framed stream into a Readable that provides the framed data.
class ReadableFramedStream extends stream.Readable
  constructor: (@stream) ->
    super()

  _read: (bytes) ->
    toolkit.qread(@stream, 1).then (prefix) =>
      if (not prefix?) or prefix[0] == 0 then return @push null
      toolkit.qread(@stream, prefix[0]).then (lengthBuffer) =>
        if not lengthBuffer? then return @push null
        length = zint.decodePackedInt(lengthBuffer)
        # empty frame? move on.
        if length == 0 then return @_read(bytes)
        toolkit.qread(@stream, length).then (data) =>
          @push data


exports.ReadableFramedStream = ReadableFramedStream
exports.WritableFramedStream = WritableFramedStream
