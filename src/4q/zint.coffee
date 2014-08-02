util = require "util"

encodeZint = (number) ->
  bytes = []
  while number > 0x7f
    bytes.push 0x80 | (number & 0x7f)
    # don't use >> here. js will truncate the number to a 32-bit int.
    number /= 128
  bytes.push number & 0x7f
  new Buffer(bytes)

decodeZint = (buffer, n = 0) ->
  rv = 0
  multiplier = 1
  while (buffer[n] & 0x80) > 0
    rv += (buffer[n] & 0x7f) * multiplier
    multiplier *= 128
    n += 1
  rv += (buffer[n] & 0x7f) * multiplier
  [ rv, n + 1 ]


exports.decodeZint = decodeZint
exports.encodeZint = encodeZint
