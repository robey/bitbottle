bottle_header = require "./bottle_header"
bottle_stream = require "./bottle_stream"
crypto = require "crypto"
Q = require "q"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"

FIELDS =
  NUMBERS:
    HASH_TYPE: 0

HASH_SHA512 = 0


# crypto's streaming hash doesn't quite work: https://github.com/joyent/node/issues/5216
# but it's simple to replace, so just do that.
class HashingStream extends stream.Transform
  constructor: (hashName, options) ->
    super(options)
    @hasher = crypto.createHash(hashName)

  _transform: (buffer, _, callback) ->
    @hasher.update(buffer)
    @push buffer
    callback()

  _flush: (callback) ->
    @digest = @hasher.digest()
    callback()


hashStreamForType = (hashType) ->
  switch hashType
    when HASH_SHA512 then new HashingStream("sha512")
    else throw new Error("Unknown hash type: #{hashType}")


# Takes a Readable stream (usually a WritableBottleStream) and produces a new
# Readable stream containing the original and its hash digest.
class HashBottleWriter extends bottle_stream.BottleWriter
  constructor: (@hashType) ->
    header = new bottle_header.Header()
    header.addNumber(FIELDS.NUMBERS.HASH_TYPE, @hashType)
    super(bottle_stream.TYPE_HASHED, header)

  _transform: (inStream, _, callback) ->
    hashStream = inStream.pipe(hashStreamForType(@hashType))
    @_process(hashStream).then =>
      @_process(new toolkit.SourceStream(hashStream.digest)).then ->
        callback()
    .fail (error) ->
      callback(error)


decodeHashHeader = (h) ->
  rv = { }
  for field in h.fields
    switch field.type
      when bottle_header.TYPE_ZINT
        switch field.id
          when FIELDS.NUMBERS.HASH_TYPE then rv.hashType = field.number
  rv


# returns a promise: { stream, valid }
# - bottle: the inner stream (another bottle)
# - valid: a promise resolving to true/false after the bottle is finished,
#     true if the hash validated correctly, false if not
validateHashBottle = (bottle) ->
  hashStream = hashStreamForType(bottle.header.hashType)
  toolkit.qread(bottle).then (innerBottleStream) ->
    innerBottleStream.pipe(hashStream)
    bottle_stream.readBottleFromStream(hashStream).then (innerBottle) ->
      promise = toolkit.qend(innerBottle).then ->
        toolkit.qread(bottle).then (digestStream) ->
          toolkit.qpipeToBuffer(digestStream).then (digestBuffer) ->
            digestBuffer.toString("hex") == hashStream.digest.toString("hex")
      { bottle: innerBottle, valid: promise }


exports.decodeHashHeader = decodeHashHeader
exports.HASH_SHA512 = HASH_SHA512
exports.validateHashBottle = validateHashBottle
exports.HashBottleWriter = HashBottleWriter
