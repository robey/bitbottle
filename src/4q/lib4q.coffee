bottle_stream = require "./lib4q/bottle_stream"
compressed_bottle = require "./lib4q/compressed_bottle"
file_bottle = require "./lib4q/file_bottle"
hash_bottle = require "./lib4q/hash_bottle"

exports.BottleWriter = bottle_stream.BottleWriter
exports.ReadableBottle = bottle_stream.ReadableBottle
exports.readBottleFromStream = bottle_stream.readBottleFromStream

exports.CompressedBottleWriter = compressed_bottle.CompressedBottleWriter

exports.FileBottleWriter = file_bottle.FileBottleWriter
exports.fileHeaderFromStats = file_bottle.fileHeaderFromStats
exports.FolderBottleWriter = file_bottle.FolderBottleWriter

exports.validateHashBottle = hash_bottle.validateHashBottle
exports.HashBottleWriter = hash_bottle.HashBottleWriter

exports.TYPE_FILE = bottle_stream.TYPE_FILE
exports.TYPE_HASHED = bottle_stream.TYPE_HASHED
exports.TYPE_COMPRESSED = bottle_stream.TYPE_COMPRESSED

exports.HASH_SHA512 = hash_bottle.HASH_SHA512

exports.COMPRESSION_LZMA2 = compressed_bottle.COMPRESSION_LZMA2
