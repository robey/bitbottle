stream = require "stream"

toHex = (buffer) ->
  strings = [0 ... buffer.length].map (n) ->
    x = buffer[n].toString(16)
    if x.length < 2 then x = "0" + x
    x
  strings.join("")

fromHex = (str) ->
  new Buffer([0 ... str.length / 2].map (i) -> parseInt(str[i * 2 ... (i + 1) * 2], 16))

bufferSource = (b) ->
  if typeof b == "string" then b = new Buffer(b)
  s = new stream.Readable()
  s._read = (size) ->
    s.push b
    s.push null
  s

bufferSink = ->
  s = new stream.Writable()
  s.buffers = []
  s._write = (chunk, encoding, callback) ->
    s.buffers.push chunk
    callback(null)
  s.getBuffer = -> Buffer.concat(s.buffers)
  s


exports.bufferSink = bufferSink
exports.bufferSource = bufferSource
exports.fromHex = fromHex
exports.toHex = toHex
