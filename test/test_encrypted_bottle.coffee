Promise = require "bluebird"
mocha_sprinkles = require "mocha-sprinkles"
toolkit = require "stream-toolkit"
util = require "util"

bottle_stream = require "../lib/4q/lib4q/bottle_stream"
file_bottle = require "../lib/4q/lib4q/file_bottle"
encrypted_bottle = require "../lib/4q/lib4q/encrypted_bottle"

future = mocha_sprinkles.future

DATA1 = new Buffer("hello sailor!")


describe "EncryptedBottleWriter", ->
  describe "encrypts", ->
    it "with no recipients", future ->
      es = new encrypted_bottle.EncryptedBottleWriter(encrypted_bottle.ENCRYPTION_AES_256)
      toolkit.sourceStream(DATA1).pipe(es)
      toolkit.pipeToBuffer(es).then (buffer) ->
        # now decrypt
        bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer))
      .then (encryptedBottle) ->
        encryptedBottle.type.should.eql bottle_stream.TYPE_ENCRYPTED
        encryptedBottle.header.encryptionType.should.eql encrypted_bottle.ENCRYPTION_AES_256
        encryptedBottle.header.recipients.should.eql [ ]
        encryptedBottle.readKeys().then (keys) =>
          keys.should.eql {}
          encryptedBottle.decrypt(es.encryptionKey)
        .then (stream) ->
          toolkit.pipeToBuffer(stream)
        .then (buffer) ->
          buffer.should.eql DATA1

    it "with one recipient", future ->
      savedKey = null
      encrypter = (name, buffer) ->
        savedKey = buffer
        Promise.resolve(new Buffer("odie"))
      es = new encrypted_bottle.EncryptedBottleWriter(encrypted_bottle.ENCRYPTION_AES_256, [ "garfield" ], encrypter)
      toolkit.sourceStream(DATA1).pipe(es)
      toolkit.pipeToBuffer(es).then (buffer) ->
        # now decrypt
        bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer))
      .then (encryptedBottle) ->
        encryptedBottle.type.should.eql bottle_stream.TYPE_ENCRYPTED
        encryptedBottle.header.encryptionType.should.eql encrypted_bottle.ENCRYPTION_AES_256
        encryptedBottle.header.recipients.should.eql [ "garfield" ]
        encryptedBottle.readKeys().then (keys) =>
          Object.keys(keys).should.eql [ "garfield" ]
          keys.garfield.toString().should.eql "odie"
          encryptedBottle.decrypt(savedKey)
        .then (stream) ->
          toolkit.pipeToBuffer(stream)
        .then (buffer) ->
          buffer.should.eql DATA1

    it "with two recipients", future ->
      encrypter = (name, buffer) ->
        keyBuffer = new Buffer(8 + buffer.length)
        keyBuffer.fill(0x20)
        new Buffer(name).copy(keyBuffer, 0)
        buffer.copy(keyBuffer, 8)
        Promise.resolve(keyBuffer)
      es = new encrypted_bottle.EncryptedBottleWriter(encrypted_bottle.ENCRYPTION_AES_256, [ "garfield", "odie" ], encrypter)
      toolkit.sourceStream(DATA1).pipe(es)
      toolkit.pipeToBuffer(es).then (buffer) ->
        # now decrypt
        bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer))
      .then (encryptedBottle) ->
        encryptedBottle.type.should.eql bottle_stream.TYPE_ENCRYPTED
        encryptedBottle.header.encryptionType.should.eql encrypted_bottle.ENCRYPTION_AES_256
        encryptedBottle.header.recipients.should.eql [ "garfield", "odie" ]
        encryptedBottle.readKeys().then (keys) =>
          Object.keys(keys).should.eql [ "garfield", "odie" ]
          key = keys.garfield.slice(8)
          encryptedBottle.decrypt(key)
        .then (stream) ->
          toolkit.pipeToBuffer(stream)
        .then (buffer) ->
          buffer.should.eql DATA1

    it "with a key", future ->
      keyBuffer = new Buffer(48)
      keyBuffer.fill(0)
      es = new encrypted_bottle.EncryptedBottleWriter(encrypted_bottle.ENCRYPTION_AES_256, [ ], keyBuffer)
      toolkit.sourceStream(DATA1).pipe(es)
      toolkit.pipeToBuffer(es).then (buffer) ->
        # now decrypt
        bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer))
      .then (encryptedBottle) ->
        encryptedBottle.type.should.eql bottle_stream.TYPE_ENCRYPTED
        encryptedBottle.header.encryptionType.should.eql encrypted_bottle.ENCRYPTION_AES_256
        encryptedBottle.header.recipients.should.eql [ ]
        encryptedBottle.readKeys().then (keys) =>
          Object.keys(keys).should.eql [ ]
          encryptedBottle.decrypt(keyBuffer)
        .then (stream) ->
          toolkit.pipeToBuffer(stream)
        .then (buffer) ->
          buffer.should.eql DATA1
