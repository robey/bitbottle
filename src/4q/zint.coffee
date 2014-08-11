util = require "util"

encodePackedInt = (number) ->
  if number < 0 then throw new Error("Unsigned ints only, plz")
  bytes = []
  while number > 0xff
    bytes.push(number & 0xff)
    # don't use >> here. js will truncate the number to a 32-bit int.
    number /= 256
  bytes.push(number & 0xff)
  new Buffer(bytes)

decodePackedInt = (buffer) ->
  rv = 0
  multiplier = 1
  [0 ... buffer.length].map (i) ->
    rv += (buffer[i] & 0xff) * multiplier
    multiplier *= 256
  rv

exports.decodePackedInt = decodePackedInt
exports.encodePackedInt = encodePackedInt
