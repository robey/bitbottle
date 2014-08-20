file_bottle = require "./lib4q/file_bottle"
bottle_stream = require "./lib4q/bottle_stream"

exports.ReadableBottle = bottle_stream.ReadableBottle
exports.readBottleFromStream = bottle_stream.readBottleFromStream
exports.WritableBottle = bottle_stream.WritableBottle

exports.fileHeaderFromStats = file_bottle.fileHeaderFromStats
exports.writeFileBottle = file_bottle.writeFileBottle
exports.writeFileBottleFromFile = file_bottle.writeFileBottleFromFile

exports.TYPE_FILE = bottle_stream.TYPE_FILE
