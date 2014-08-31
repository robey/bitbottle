bottle_stream = require "./lib4q/bottle_stream"
file_bottle = require "./lib4q/file_bottle"
hash_bottle = require "./lib4q/hash_bottle"

exports.BottleWriter = bottle_stream.BottleWriter
exports.ReadableBottle = bottle_stream.ReadableBottle
exports.readBottleFromStream = bottle_stream.readBottleFromStream

exports.fileHeaderFromStats = file_bottle.fileHeaderFromStats
exports.writeFileBottle = file_bottle.writeFileBottle
exports.writeFileBottleFromFile = file_bottle.writeFileBottleFromFile

exports.validateHashBottle = hash_bottle.validateHashBottle
exports.HashBottleWriter = hash_bottle.HashBottleWriter

exports.TYPE_FILE = bottle_stream.TYPE_FILE
exports.TYPE_HASHED = bottle_stream.TYPE_HASHED

exports.HASH_SHA512 = hash_bottle.HASH_SHA512
