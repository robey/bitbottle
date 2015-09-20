"use strict";

import * as bottle_header from "./bottle_header";
import * as bottle_stream from "./bottle_stream";
import crypto from "crypto";
import Promise from "bluebird";
import scrypt from "js-scrypt";
import toolkit from "stream-toolkit";

const FIELDS = {
  NUMBERS: {
    ENCRYPTION_TYPE: 0
  },
  STRINGS: {
    RECIPIENTS: 0,
    SCRYPT: 1
  }
};

export const ENCRYPTION_AES_256_CTR = 0;

const ENCRYPTION_NAMES = {
  [ENCRYPTION_AES_256_CTR]: "AES-256-CTR"
};

const SCRYPT_N = 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;


function encryptedStreamForType(encryptionType, keyBuffer) {
  switch (encryptionType) {
    case ENCRYPTION_AES_256_CTR:
      return (keyBuffer ? Promise.resolve(keyBuffer) : Promise.promisify(crypto.randomBytes)(48)).then((buffer) => {
        const key = buffer.slice(0, 32);
        const iv = buffer.slice(32, 48);
        const stream = crypto.createCipheriv("aes-256-ctr", key, iv);
        return { key: buffer, stream };
      });
    default:
      throw new Error(`Unknown encryption type: ${encryptionType}`);
  }
}

function decryptedStreamForType(encryptionType, keyBuffer) {
  switch (encryptionType) {
    case ENCRYPTION_AES_256_CTR:
      const key = keyBuffer.slice(0, 32);
      const iv = keyBuffer.slice(32, 48);
      return crypto.createDecipheriv("aes-256-ctr", key, iv);
    default:
      throw new Error(`Unknown encryption type: ${encryptionType}`);
  }
}

function makeHeader(encryptionType, options = {}) {
  const header = new bottle_header.Header();
  header.addNumber(FIELDS.NUMBERS.ENCRYPTION_TYPE, encryptionType);
  if (options.recipients && options.recipients.length > 0) {
    header.addStringList(FIELDS.STRINGS.RECIPIENTS, options.recipients);
  }
  if (options.password) {
    // make a salt and stuff
    options.salt = crypto.randomBytes(8);
    header.addString(FIELDS.STRINGS.SCRYPT, `${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${options.salt.toString("base64")}`);
  }
  return header;
}

/*
 * Produces an encrypted bottle of whatever is piped into it. The data is
 * encrypted either by:
 * - passing in a `key`, if you already have one
 * - passing in a `recipients` list and an `encrypter`, if you'd like the key
 *   to be generated and then encrypted using a service like keybase
 * - passing in a `password`, if you want to generate the key with scrypt
 *
 * Options:
 * - `key`: `Buffer` the key to use for encryption, if you have one already
 * - `recipients`: list of recipients to generate encrypted key buffers for;
 *   if you use this, you must also pass in an `encrypter`
 * - `encrypter`: `(recipient: String, key: Buffer) => Promise(Buffer)`
 *   function to generate an encrypted key for this recipient
 * - `password`: `String` to use to generate a key
 */
export class EncryptedBottleWriter extends bottle_stream.BottleWriter {
  constructor(encryptionType, options = {}) {
    super(
      bottle_stream.TYPE_ENCRYPTED,
      makeHeader(encryptionType, options),
      { objectModeRead: false, objectModeWrite: false }
    );
    this.encryptionType = encryptionType;
    this.options = options;

    this.ready = Promise.resolve();
    if (options.key) {
      this.ready = encryptedStreamForType(this.encryptionType, options.key).then(({ stream }) => {
        this.encryptedStream = stream;
      });
    } else if (options.recipients && options.encrypter) {
      this.ready = encryptedStreamForType(this.encryptionType).then(({ key, stream }) => {
        this.encryptedStream = stream;
        return Promise.all(
          Promise.map(options.recipients, recipient => {
            return options.encrypter(recipient, key).then(buffer => {
              return this._process(toolkit.sourceStream(buffer));
            });
          }, { concurrency: 1 })
        );
      });
    } else if (options.password) {
      // must use the sync version here: async version can cause the interpreter to forget to die.
      this.ready = Promise.resolve(scrypt.hashSync(options.password, options.salt, {
        cost: Math.pow(2, SCRYPT_N),
        blockSize: SCRYPT_R,
        parallel: SCRYPT_P
      })).then(key => {
        return encryptedStreamForType(this.encryptionType, key);
      }).then(({ stream }) => {
        this.encryptedStream = stream;
      });
    } else {
      throw new Error("Must pass a key, encrypter, or password");
    }

    this.ready.catch(error => {
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

export function writeEncryptedBottle(encryptionType, options = {}) {
  const bottle = new EncryptedBottleWriter(encryptionType, options);
  return bottle.ready.then(() => bottle);
}


export function decodeEncryptionHeader(h) {
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
          case FIELDS.STRINGS.SCRYPT:
            rv.scrypt = field.string.split(":");
            break;
        }
        break;
    }
  });
  if (rv.encryptionType == null) rv.encryptionType = ENCRYPTION_AES_256_CTR;
  rv.encryptionName = ENCRYPTION_NAMES[rv.encryptionType];
  return rv;
}

export class EncryptedBottleReader extends bottle_stream.BottleReader {
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
    return this.readPromise().then(innerStream => {
      innerStream.pipe(stream);
      return stream;
    });
  }

  /*
   * returns:
   * - keymap: a map of recipient name to encrypted buffer
   * - scrypt: possible scrypt parameters
   */
  readKeys() {
    this.keys = {};
    return Promise.all(
      Promise.map(this.header.recipients || [], recipient => {
        return this.readPromise().then(innerStream => {
          return toolkit.pipeToBuffer(innerStream).then(buffer => {
            this.keys[recipient] = buffer;
          });
        });
      }, { concurrency: 1 })
    ).then(() => {
      return { keymap: this.keys, scrypt: this.header.scrypt };
    });
  }

  /*
   * given a user-provided password, and the scyrpt parameters from the
   * header, generate the key used.
   */
  generateKey(password, params) {
    const [ n, r, p, salt ] = params;
    return Promise.resolve(scrypt.hashSync(password, new Buffer(salt, "base64"), {
      cost: Math.pow(2, parseInt(n, 10)),
      blockSize: parseInt(r, 10),
      parallel: parseInt(p, 10)
    }));
  }
}
