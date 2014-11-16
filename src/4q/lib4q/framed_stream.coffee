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
    if @bufferSize >= @blockSize then @_drain(callback) else callback()

  _flush: (callback) ->
    @_drain =>
      @push new Buffer([ 0 ])
      callback()

  _drain: (callback) ->
    return callback() if @bufferSize == 0
    # hook: let the caller do a final transform on the buffers before we calculate the length.
    if @innerTransform?
      @innerTransform @buffer, (buffers) =>
        @buffer = buffers
        @bufferSize = 0
        for b in buffers then @bufferSize += b.length
        @__drain(callback)
    else
      @__drain(callback)

  __drain: (callback) ->
    @push encodeLength(@bufferSize)
    @buffer.map (d) => @push d
    @buffer = []
    @bufferSize = 0
    callback()


# wrap a framed stream into a Readable that provides the framed data.
class ReadableFramedStream extends stream.Readable
  constructor: (@stream) ->
    super()

  _read: (bytes) ->
    readLength(@stream).then (length) =>
      if (not length?) or (length == 0) then return @push null
      toolkit.qread(@stream, length).then (data) =>
        @push data

# 0xxxxxxx - 0 thru 2^7 = 128 (0 = end of stream)
# 10xxxxxx - (+ 1 byte) = 2^14 = 8K
# 110xxxxx - (+ 2 byte) = 2^21 = 2M
# 1110xxxx - (+ 3 byte) = 2^28 = 128M
# 1111xxxx - 2^(7+x) = any power-of-2 block size from 128 to 2^22 = 4M
encodeLength = (n) ->
  if n < 128 then return new Buffer([ n ])
  if n <= Math.pow(2, 22) and (n & (n - 1)) == 0 then return new Buffer([ 0xf0 + logBase2(n) - 7 ])
  if n < 8192 then return new Buffer([ 0x80 + (n & 0x3f), (n >> 6) & 0xff ])
  if n < Math.pow(2, 21) then return new Buffer([ 0xc0 + (n & 0x1f), (n >> 5) & 0xff, (n >> 13) & 0xff ])
  if n < Math.pow(2, 28) then return new Buffer([ 0xe0 + (n & 0xf), (n >> 4) & 0xff, (n >> 12) & 0xff, (n >> 20) & 0xff ])
  throw new Error(">:-P -> #{n}")

readLength = (stream) ->
  toolkit.qread(stream, 1).then (prefix) ->
    if (not prefix?) or prefix[0] == 0 then return null
    if (prefix[0] & 0x80) == 0 then return prefix[0]
    if (prefix[0] & 0xf0) == 0xf0 then return Math.pow(2, 7 + (prefix[0] & 0xf))
    if (prefix[0] & 0xc0) == 0x80
      return toolkit.qread(stream, 1).then (data) ->
        if not data? then return null
        (prefix[0] & 0x3f) + (data[0] << 6)
    if (prefix[0] & 0xe0) == 0xc0
      return toolkit.qread(stream, 2).then (data) ->
        if not data? then return null
        (prefix[0] & 0x3f) + (data[0] << 5) + (data[1] << 13)
    if (prefix[0] & 0xf0) == 0xe0
      return toolkit.qread(stream, 3).then (data) ->
        if not data? then return null
        (prefix[0] & 0xf) + (data[0] << 4) + (data[1] << 12) + (data[2] << 20)
    null

# hacker's delight! (only works on exact powers of 2)
logBase2 = (x) ->
  x -= 1
  x -= ((x >> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333)
  x = (x + (x >> 4)) & 0x0F0F0F0F
  x += (x << 8)
  x += (x << 16)
  x >> 24


exports.ReadableFramedStream = ReadableFramedStream
exports.WritableFramedStream = WritableFramedStream
