"use strict";

import { Header, TYPE_STRING, TYPE_ZINT } from "./bottle_header";
import { bottleWriter, TYPE_ENCRYPTED } from "./bottle_stream";
import crypto from "crypto";
import Promise from "bluebird";
import scrypt from "js-scrypt";
import { pipeToBuffer, sourceStream } from "stream-toolkit";

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


/*
 * Produces an encrypted bottle of whatever is piped into it. The data is
 * encrypted either by:
 *   - passing in a `key`, if you already have one
 *   - passing in a `recipients` list and an `encrypter`, if you'd like the
 *     key to be generated and then encrypted using a service like keybase
 *   - passing in a `password`, if you want to generate the key with scrypt
 *
 * Options:
 *   - `key`: `Buffer` the key to use for encryption, if you have one already
 *   - `recipients`: list of recipients to generate encrypted key buffers
 *     for; if you use this, you must also pass in an `encrypter`
 *   - `encrypter`: `(recipient: String, key: Buffer) => Promise(Buffer)`
 *     function to generate an encrypted key for this recipient
 *   - `password`: `String` to use to generate a key
 */
export function encryptedBottleWriter(encryptionType, options = {}) {
  const header = new Header();
  header.addNumber(FIELDS.NUMBERS.ENCRYPTION_TYPE, encryptionType);
  if (options.recipients && options.recipients.length > 0) {
    header.addStringList(FIELDS.STRINGS.RECIPIENTS, options.recipients);
  }
  if (options.password) {
    // make a salt and stuff
    options.salt = crypto.randomBytes(8);
    header.addString(FIELDS.STRINGS.SCRYPT, `${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${options.salt.toString("base64")}`);
  }

  const bottle = bottleWriter(TYPE_ENCRYPTED, header);
  const key = makeKey(options);
  return encryptionTransformForType(encryptionType, key).then(({ key, writer }) => {
    return writeKeys(bottle, key, options).then(() => {
      bottle.write(writer);
      bottle.end();
      return { writer, bottle };
    });
  });
}

function makeKey(options) {
  if (options.key) return options.key;
  if (options.recipients && options.encrypter) return null;
  if (options.password) {
    // must use the sync version here: async version can cause the interpreter to forget to die.
    return scrypt.hashSync(options.password, options.salt, {
      cost: Math.pow(2, SCRYPT_N),
      blockSize: SCRYPT_R,
      parallel: SCRYPT_P
    });
  }
  throw new Error("Must pass a key, encrypter, or password");
}

function writeKeys(bottle, key, options) {
  if (options.key || options.password) return Promise.resolve();
  return Promise.all(
    Promise.map(options.recipients, recipient => {
      return options.encrypter(recipient, key).then(buffer => {
        return bottle.writePromise(sourceStream(buffer));
      });
    }, { concurrency: 1 })
  );
}

// returns { key, writer }
function encryptionTransformForType(encryptionType, keyBuffer) {
  switch (encryptionType) {
    case ENCRYPTION_AES_256_CTR:
      return (keyBuffer ? Promise.resolve(keyBuffer) : Promise.promisify(crypto.randomBytes)(48)).then(buffer => {
        const key = buffer.slice(0, 32);
        const iv = buffer.slice(32, 48);
        const stream = crypto.createCipheriv("aes-256-ctr", key, iv);
        return { key: buffer, writer: stream };
      });
    default:
      throw new Error(`Unknown encryption type: ${encryptionType}`);
  }
}

// -----

export function decodeEncryptionHeader(h) {
  const rv = {};
  h.fields.forEach(field => {
    switch (field.type) {
      case TYPE_ZINT:
        switch (field.id) {
          case FIELDS.NUMBERS.ENCRYPTION_TYPE:
            rv.encryptionType = field.number;
            break;
        }
        break;
      case TYPE_STRING:
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

/*
 * Options:
 *   - `key`: `Buffer` the key to use for decryption, if you have one already
 *   - `decrypter`: `(keymap: Map(String, Buffer)) => Promise(Buffer)`
 *     function to generate an decrypted key, given a map of recipients to
 *     encrypted keys
 *   - `getPassword`: `() => Promise(String)` requested when the key is
 *     encrypted with scrypt
 */
export function encryptedBottleReader(header, bottleReader, options = {}) {
  const decrypter = options.decrypter || (() => Promise.reject(new Error("No decrypter given")));
  const getPassword = options.getPassword || (() => Promise.reject(new Error("No getPassword given")));

  return readKeys(header, bottleReader).then(keymap => {
    return decodeKey(options.key, keymap, header.scrypt, decrypter, getPassword).then(key => {
      const stream = decryptedStreamForType(header.encryptionType, key);
      return bottleReader.readPromise().then(innerStream => {
        innerStream.pipe(stream);
        return stream;
      });
    });
  });
}

/*
 * if the header lists recipients, read the Map of recipient names to
 * encrypted keys, and return it.
 */
function readKeys(header, bottleReader) {
  const keyMap = new Map();
  return Promise.all(
    Promise.map(header.recipients || [], recipient => {
      return bottleReader.readPromise().then(innerStream => {
        return pipeToBuffer(innerStream).then(buffer => {
          keyMap.set(recipient, buffer);
        });
      });
    }, { concurrency: 1 })
  ).then(() => keyMap);
}

function decodeKey(key, keymap, params, decrypter, getPassword) {
  if (key) return Promise.resolve(key);
  if (keymap.size > 0) return Promise.try(() => decrypter(keymap));
  if (!params || params.length != 4) throw new Error("No key, no keymap, and no scrypt parameters");

  const [ n, r, p, salt ] = params;
  return Promise.try(() => getPassword()).then(password => {
    return scrypt.hashSync(password, new Buffer(salt, "base64"), {
      cost: Math.pow(2, parseInt(n, 10)),
      blockSize: parseInt(r, 10),
      parallel: parseInt(p, 10)
    });
  });
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
