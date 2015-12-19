"use strict";

import crypto from "crypto";
import Promise from "bluebird";
import { Header, TYPE_STRING, TYPE_ZINT } from "./bottle_header";
import { writeBottle, TYPE_HASHED } from "./bottle_stream";
import { pipeToBuffer, sourceStream, Transform } from "stream-toolkit";

const FIELDS = {
  NUMBERS: {
    HASH_TYPE: 0
  },
  STRINGS: {
    SIGNED_BY: 0
  }
};

export const HASH_SHA512 = 0;

const HASH_NAMES = {
  [HASH_SHA512]: "SHA-512"
};


/*
 * Produle a bottle that hashes (and optionally signs) a stream.
 *
 * Options:
 *   - signedBy: `String` if the hash should be signed, who was it signed by
 *   - signer: `Buffer => Promise(Buffer)`: perform the signing, and
 *     return a signed blob that contains the original buffer inside it
 */
export function writeHashBottle(hashType, options = {}) {
  const _babel_bug = hash => Promise.resolve(hash);
  const signer = options.signer || _babel_bug;

  const header = new Header();
  header.addNumber(FIELDS.NUMBERS.HASH_TYPE, hashType);
  if (options.signedBy) header.addString(FIELDS.STRINGS.SIGNED_BY, options.signedBy);

  const bottle = writeBottle(TYPE_HASHED, header);
  const writer = hashStreamForType(hashType);
  bottle.write(writer);
  writer.on("end", () => {
    return Promise.try(() => signer(writer.digest)).then(hashData => {
      bottle.write(sourceStream(hashData));
      bottle.end();
    }, error => bottle.emit("error", error));
  });
  return Promise.resolve({ writer, bottle });
}

function hashStreamForType(hashType) {
  switch (hashType) {
    case HASH_SHA512:
      return hashingStream("sha512");
    default:
      throw new Error(`Unknown hash type: ${hashType}`);
  }
}

// crypto's streaming hash doesn't quite work: https://github.com/joyent/node/issues/5216
// but it's simple to replace, so just do that.
function hashingStream(hashName) {
  const hasher = crypto.createHash(hashName);

  const rv = new Transform({
    transform: data => {
      hasher.update(data);
      return data;
    },
    flush: () => {
      rv.digest = hasher.digest();
      return null;
    }
  });
  return rv;
}


// -----

export function decodeHashHeader(h) {
  const rv = {};
  h.fields.forEach(field => {
    switch (field.type) {
      case TYPE_ZINT:
        switch (field.id) {
          case FIELDS.NUMBERS.HASH_TYPE:
            rv.hashType = field.number;
            break;
        }
        break;
      case TYPE_STRING:
        switch (field.id) {
          case FIELDS.STRINGS.SIGNED_BY:
            rv.signedBy = field.string;
            break;
        }
        break;
    }
  });
  if (rv.hashType == null) rv.hashType = HASH_SHA512;
  rv.hashName = HASH_NAMES[rv.hashType];
  return rv;
}

/*
 * Returns a promise containing:
 *   - stream: inner stream
 *   - hexPromise: promise for a hex of the hash, resolved if it matched or
 *     was signed correctly (rejected if not)
 *
 * Options:
 *   - `verifier`: `(Buffer, signedBy: String) => Promise(Buffer)`: if the
 *     hash was signed, unpack the signature, verify that it was signed by
 *     `signedBy`, and return either the signed data or an exception
 */
export function readHashBottle(header, bottleReader, options = {}) {
  const hashStream = hashStreamForType(header.hashType);
  if (header.signedBy && !options.verifier) throw new Error("No verifier given");
  const _babel_bug = buffer => Promise.resolve(buffer);
  const verifier = options.verifier || _babel_bug;

  return bottleReader.readPromise().then(stream => {
    stream.pipe(hashStream);

    const hexPromise = new Promise((resolve, reject) => {
      hashStream.endPromise().then(() => {
        return bottleReader.readPromise().then(digestStream => {
          return pipeToBuffer(digestStream).then(signedBuffer => {
            return verifier(signedBuffer, header.signedBy);
          }).then(digestBuffer => {
            const realHex = hashStream.digest.toString("hex");
            const gotHex = digestBuffer.toString("hex");
            if (realHex == gotHex) {
              resolve(gotHex);
            } else {
              reject(new Error(`Incorrect hash (expected ${realHex}, got ${gotHex})`));
            }
          });
        });
      }).catch(error => reject(error));
    });

    return { stream: hashStream, hexPromise };
  });
}
