util = require "util"
zint = require "zint"

class Metadata
  constructor: ->
    @fields = []

  addBool: (id) ->
    @fields.push { id, content: new Buffer(0) }

  addNumber: (id, number) ->
    @fields.push { id, content: zint.encodeZint(number) }

  addString: (id, str) ->
    @fields.push { id, content: new Buffer(str, "UTF-8") }

  addStringList: (id, list) ->
    @fields.push { id, content: Buffer.concat(list.map (str) -> new Buffer(str, "UTF-8")) }

  pack: ->
    # each metadata item has a 16-bit header: DDDDDDLL LLLLLLLL (D = id#, L = length)
    buffers = []
    for f in @fields
      if f.id > 63 or f.id < 0 then throw new Error("Metadata ID out of range: #{id}")
      if f.content.length > 1023 then throw new Error("Metadata #{id} too large (#{f.content.length}, max 1023)")
      buffers.push new Buffer([ (f.id << 2) | ((f.content.length >> 8) & 0x2), (f.content.length & 0xff) ])
      buffers.push f.content
    buffers
