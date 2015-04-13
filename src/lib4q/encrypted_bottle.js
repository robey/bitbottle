"use strict";

const bottle_header = require("./bottle_header");
const bottle_stream = require("./bottle_stream");
const crypto = require("crypto");
const Promise = require("bluebird");
const stream = require("stream");
const toolkit = require("stream-toolkit");
const util = require("util");

const FIELDS = {
  NUMBERS: {
    ENCRYPTION_TYPE: 0
  },
  STRINGS: {
    RECIPIENTS: 0
  }
};

const ENCRYPTION_AES_256 = 0;

const ENCRYPTION_NAMES = {
  [ENCRYPTION_AES_256]: "AES-256"
};


function encryptedStreamForType(encryptionType, keyBuffer) {
  switch (encryptionType) {
    case ENCRYPTION_AES_256:
      return (keyBuffer ? Promise.resolve(keyBuffer) : Promise.promisify(crypto.randomBytes)(48)).then((buffer) => {
        const key = buffer.slice(0, 32);
        const iv = buffer.slice(32, 48);
        const stream = crypto.createCipheriv("aes256", key, iv);
        return { key: buffer, stream };
      });
    default:
      throw new Error(`Unknown encryption type: ${encryptionType}`);
  }
}

function decryptedStreamForType(encryptionType, keyBuffer) {
  switch (encryptionType) {
    case ENCRYPTION_AES_256:
      const key = keyBuffer.slice(0, 32);
      const iv = keyBuffer.slice(32, 48);
      return crypto.createDecipheriv("aes256", key, iv);
    default:
      throw new Error(`Unknown encryption type: ${encryptionType}`);
  }
}

function makeHeader(encryptionType, recipients) {
  const header = new bottle_header.Header();
  header.addNumber(FIELDS.NUMBERS.ENCRYPTION_TYPE, encryptionType);
  if (recipients.length > 0) {
    header.addStringList(FIELDS.STRINGS.RECIPIENTS, recipients);
  }
  return header;
}

// Takes a Readable stream (usually a WritableBottleStream) and produces a new
// Readable stream containing the encrypted contents and the key encrypted for
// an optional set of recipients.
// if recipients are given, 'encrypter' must be a function that encrypts a
// buffer for a recipient:
//     (recipient, buffer) -> promise(buffer)
class EncryptedBottleWriter extends bottle_stream.BottleWriter {
  constructor(encryptionType, recipients = [], encrypter = null) {
    super(
      bottle_stream.TYPE_ENCRYPTED,
      makeHeader(encryptionType, recipients),
      { objectModeRead: false, objectModeWrite: false }
    );
    this.encryptionType = encryptionType;
    this.recipients = recipients;
    this.encrypter = encrypter;

    // make a single framed stream that we channel.
    const keyBuffer = (recipients.length == 0 ? this.encrypter : null);
    this.ready = encryptedStreamForType(this.encryptionType, keyBuffer).then(({ key, stream }) => {
      this.encryptionKey = key;
      this.encryptedStream = stream;
      return Promise.all(
        Promise.map(this.recipients, (recipient) => {
          return this.encrypter(recipient, key).then((buffer) => {
            return this._process(toolkit.sourceStream(buffer));
          })
        }, { concurrency: 1 })
      );
    });
    this.ready.catch((error) => {
      this.emit("error", error);
    });
    this.ready.then(() => {
      this._process(this.encryptedStream);
    });
  }

  _transform(data, _, callback) {
    this.ready.then(() => {
      this.encryptedStream.write(data, _, callback);
    });
  }

  _flush(callback) {
    this.encryptedStream.end();
    this.encryptedStream.on("end", () => {
      this._close();
      callback();
    });
  }
}

function writeEncryptedBottle(encryptionType, recipients = [], encrypter = null) {
  const bottle = new EncryptedBottleWriter(encryptionType, recipients, encrypter);
  return bottle.ready.then(() => bottle);
}


function decodeEncryptionHeader(h) {
  const rv = {};
  h.fields.forEach((field) => {
    switch (field.type) {
      case bottle_header.TYPE_ZINT:
        switch (field.id) {
          case FIELDS.NUMBERS.ENCRYPTION_TYPE:
            rv.encryptionType = field.number;
            break;
        }
        break;
      case bottle_header.TYPE_STRING:
        switch (field.id) {
          case FIELDS.STRINGS.RECIPIENTS:
            rv.recipients = field.list;
            break;
        }
        break;
    }
  });
  if (rv.encryptionType == null) rv.encryptionType = ENCRYPTION_AES_256;
  rv.encryptionName = ENCRYPTION_NAMES[rv.encryptionType];
  if (!rv.recipients) rv.recipients = [];
  return rv;
}

class EncryptedBottleReader extends bottle_stream.BottleReader {
  constructor(header, stream) {
    super(bottle_stream.TYPE_ENCRYPTED, header, stream);
  }

  typeName() {
    return `encrypted/${ENCRYPTION_NAMES[this.header.encryptionType]}`;
  }

  // returns a promise for the inner stream
  // *must be called after 'readKeys'*
  decrypt(keyBuffer) {
    const stream = decryptedStreamForType(this.header.encryptionType, keyBuffer);
    return this.readPromise().then((innerStream) => {
      innerStream.pipe(stream);
      return stream;
    });
  }

  // returns a promise for a map of recipient name to encrypted buffer
  readKeys() {
    this.keys = {};
    return Promise.all(
      Promise.map(this.header.recipients, (recipient) => {
        return this.readPromise().then((innerStream) => {
          return toolkit.pipeToBuffer(innerStream).then((buffer) => {
            this.keys[recipient] = buffer;
          });
        });
      }, { concurrency: 1 })
    ).then(() => this.keys);
  }
}


exports.decodeEncryptionHeader = decodeEncryptionHeader;
exports.EncryptedBottleReader = EncryptedBottleReader;
exports.EncryptedBottleWriter = EncryptedBottleWriter;
exports.ENCRYPTION_AES_256 = ENCRYPTION_AES_256;
exports.writeEncryptedBottle = writeEncryptedBottle;
