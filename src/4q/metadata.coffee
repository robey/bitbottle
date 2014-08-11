util = require "util"
zint = require "./zint"

TYPE_STRING = 0
TYPE_ZINT = 2
TYPE_BOOL = 3

class Metadata
  constructor: ->
    @fields = []

  addBool: (id) ->
    @fields.push { type: TYPE_BOOL, id, content: new Buffer(0) }

  addNumber: (id, number) ->
    @fields.push { type: TYPE_ZINT, id, content: zint.encodePackedInt(number), number }

  addString: (id, str) ->
    @addStringList(id, [ str ])

  addStringList: (id, list) ->
    buffers = list.slice(0, list.length - 1).map (str) -> new Buffer(str + "\x00", "UTF-8")
    buffers.push new Buffer(list[list.length - 1], "UTF-8")
    @fields.push { type: TYPE_STRING, id, content: Buffer.concat(buffers), list }

  pack: ->
    # each metadata item has a 16-bit header: TTDDDDLL LLLLLLLL (T = type, D = id#, L = length)
    buffers = []
    for f in @fields
      if f.id > 15 or f.id < 0 then throw new Error("Metadata ID out of range: #{f.id}")
      if f.content.length > 1023 then throw new Error("Metadata #{id} too large (#{f.content.length}, max 1023)")
      buffers.push new Buffer([
        (f.type << 6) | (f.id << 2) | ((f.content.length >> 8) & 0x2)
        (f.content.length & 0xff)
      ])
      buffers.push f.content
    buffers


unpack = (buffer) ->
  metadata = new Metadata()
  i = 0
  while i < buffer.length
    if i + 2 > buffer.length then throw new Error("Truncated metadata")
    type = (buffer[i] & 0xc0) >> 6
    id = (buffer[i] & 0x3c) >> 2
    length = (buffer[i] & 0x3) * 256 + (buffer[i + 1] & 0xff)
    i += 2
    if i + length > buffer.length then throw new Error("Truncated metadata")
    content = buffer.slice(i, i + length)
    field = { type, id }
    switch type
      when TYPE_ZINT then field.number = zint.decodePackedInt(content)
      when TYPE_STRING then field.list = content.toString("UTF-8").split("\x00")
    metadata.fields.push field
    i += length
  metadata


exports.Metadata = Metadata
exports.TYPE_BOOL = TYPE_BOOL
exports.TYPE_STRING = TYPE_STRING
exports.TYPE_ZINT = TYPE_ZINT
exports.unpack = unpack
