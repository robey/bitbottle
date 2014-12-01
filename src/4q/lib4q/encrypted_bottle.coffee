bottle_header = require "./bottle_header"
bottle_stream = require "./bottle_stream"
crypto = require "crypto"
Promise = require "bluebird"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"

FIELDS =
  NUMBERS:
    ENCRYPTION_TYPE: 0
  STRINGS:
    RECIPIENTS: 0    

ENCRYPTION_AES_256 = 0

ENCRYPTION_NAMES = {}
ENCRYPTION_NAMES[ENCRYPTION_AES_256] = "AES-256"


encryptedStreamForType = (encryptionType, keyBuffer) ->
  switch encryptionType
    when ENCRYPTION_AES_256
      (if keyBuffer? then Promise.resolve(keyBuffer) else Promise.promisify(crypto.randomBytes)(48)).then (buffer) ->
        key = buffer.slice(0, 32)
        iv = buffer.slice(32, 48)
        stream = crypto.createCipheriv("aes256", key, iv)
        { key: buffer, stream }
    else throw new Error("Unknown encryption type: #{encryptionType}")

decryptedStreamForType = (encryptionType, keyBuffer) ->
  switch encryptionType
    when ENCRYPTION_AES_256
      key = keyBuffer.slice(0, 32)
      iv = keyBuffer.slice(32, 48)
      crypto.createDecipheriv("aes256", key, iv)
    else throw new Error("Unknown encryption type: #{encryptionType}")


# Takes a Readable stream (usually a WritableBottleStream) and produces a new
# Readable stream containing the encrypted contents and the key encrypted for
# an optional set of recipients.
# if recipients are given, 'encrypter' must be a function that encrypts a
# buffer for a recipient:
#     (recipient, buffer) -> promise(buffer)
class EncryptedBottleWriter extends bottle_stream.BottleWriter
  constructor: (@encryptionType, @recipients = [], @encrypter) ->
    header = new bottle_header.Header()
    header.addNumber(FIELDS.NUMBERS.ENCRYPTION_TYPE, @encryptionType)
    if @recipients.length > 0
      header.addStringList(FIELDS.STRINGS.RECIPIENTS, @recipients)
    super(bottle_stream.TYPE_ENCRYPTED, header, objectModeRead: false, objectModeWrite: false)
    # make a single framed stream that we channel
    keyBuffer = if @recipients.length == 0 then @encrypter else null
    @ready = encryptedStreamForType(@encryptionType, keyBuffer).then ({ key, stream }) =>
      @encryptionKey = key
      @encryptedStream = stream
      Promise.all(
        Promise.map(@recipients, ((recipient) =>
          @encrypter(recipient, key).then (buffer) =>
            @_process(toolkit.sourceStream(buffer))
          ), concurrency: 1)
      )
    @ready.catch (error) =>
      @emit "error", error
    @ready.then =>
      @_process(@encryptedStream)
 
  _transform: (data, _, callback) ->
    @ready.then =>
      @encryptedStream.write(data, _, callback)

  _flush: (callback) ->
    @encryptedStream.end()
    @encryptedStream.on "end", =>
      @_close()
      callback()


decodeEncryptionHeader = (h) ->
  rv = { }
  for field in h.fields
    switch field.type
      when bottle_header.TYPE_ZINT
        switch field.id
          when FIELDS.NUMBERS.ENCRYPTION_TYPE then rv.encryptionType = field.number
      when bottle_header.TYPE_STRING
        switch field.id
          when FIELDS.STRINGS.RECIPIENTS then rv.recipients = field.list
  if not rv.encryptionType? then rv.encryptionType = ENCRYPTION_AES_256
  rv.encryptionName = ENCRYPTION_NAMES[rv.encryptionType]
  if not rv.recipients? then rv.recipients = []
  rv

class EncryptedBottleReader extends bottle_stream.BottleReader
  constructor: (header, stream) ->
    super(bottle_stream.TYPE_ENCRYPTED, header, stream)

  typeName: ->
    "encrypted/#{ENCRYPTION_NAMES[@header.encryptionType]}"

  # returns a promise for the inner stream
  # *must be called after 'readKeys'*
  decrypt: (keyBuffer) ->
    stream = decryptedStreamForType(@header.encryptionType, keyBuffer)
    @readPromise().then (innerStream) =>
      innerStream.pipe(stream)
      stream

  # returns a promise for a map of recipient name to encrypted buffer
  readKeys: ->
    @keys = {}
    Promise.all(
      Promise.map(@header.recipients, ((recipient) =>
        @readPromise().then (innerStream) =>
          toolkit.pipeToBuffer(innerStream).then (buffer) =>
            @keys[recipient] = buffer
      ), concurrency: 1)
    ).then =>
      @keys


exports.decodeEncryptionHeader = decodeEncryptionHeader
exports.EncryptedBottleReader = EncryptedBottleReader
exports.EncryptedBottleWriter = EncryptedBottleWriter
exports.ENCRYPTION_AES_256 = ENCRYPTION_AES_256
