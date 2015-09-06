"use strict";

import * as bottle_header from "./bottle_header";
import * as bottle_stream from "./bottle_stream";
import crypto from "crypto";
import stream from "stream";
import toolkit from "stream-toolkit";

const FIELDS = {
  NUMBERS: {
    HASH_TYPE: 0
  }
};

export const HASH_SHA512 = 0;

const HASH_NAMES = {
  [HASH_SHA512]: "SHA-512"
};


// crypto's streaming hash doesn't quite work: https://github.com/joyent/node/issues/5216
// but it's simple to replace, so just do that.
class HashingStream extends stream.Transform {
  constructor(hashName, options) {
    super(options);
    toolkit.promisify(this, { name: "HashingStream" });
    this.hasher = crypto.createHash(hashName);
  }

  _transform(buffer, _, callback) {
    this.hasher.update(buffer);
    this.push(buffer);
    callback();
  }

  _flush(callback) {
    this.digest = this.hasher.digest();
    callback();
  }
}


function hashStreamForType(hashType) {
  switch (hashType) {
    case HASH_SHA512:
      return new HashingStream("sha512");
    default:
      throw new Error(`Unknown hash type: ${hashType}`);
  }
}


// Takes a Readable stream (usually a WritableBottleStream) and produces a new
// Readable stream containing the original and its hash digest.
export class HashBottleWriter extends bottle_stream.BottleWriter {
  constructor(hashType) {
    super(
      bottle_stream.TYPE_HASHED,
      new bottle_header.Header().addNumber(FIELDS.NUMBERS.HASH_TYPE, hashType),
      { objectModeRead: false, objectModeWrite: false }
    );
    this.hashType = hashType;
    // make a single framed stream that we channel
    this.hashStream = hashStreamForType(this.hashType);
    this._process(this.hashStream);
  }

  _transform(data, _, callback) {
    this.hashStream.write(data, _, callback);
  }

  _flush(callback) {
    this.hashStream.on("end", () => {
      this._process(toolkit.sourceStream(this.hashStream.digest)).then(() => {
        this._close();
        callback();
      }).catch((error) => {
        callback(error);
      });
    });
    this.hashStream.end();
  }
}


export function decodeHashHeader(h) {
  const rv = {};
  h.fields.forEach((field) => {
    switch (field.type) {
      case bottle_header.TYPE_ZINT:
        switch (field.id) {
          case FIELDS.NUMBERS.HASH_TYPE:
            rv.hashType = field.number;
            break;
        }
    }
  });
  if (rv.hashType == null) rv.hashType = HASH_SHA512;
  rv.hashName = HASH_NAMES[rv.hashType];
  return rv;
}

export class HashBottleReader extends bottle_stream.BottleReader {
  constructor(header, stream) {
    super(bottle_stream.TYPE_HASHED, header, stream);
  }

  typeName() {
    return `hashed/${HASH_NAMES[this.header.hashType]}`;
  }

  // returns a promise: { bottle: BottleReader, valid: Promise(Bool), hex: Promise(String) }
  // - bottle: the inner stream (another bottle)
  // - valid: a promise resolving to true/false after the bottle is finished,
  //     true if the hash validated correctly, false if not
  validate() {
    const hashStream = hashStreamForType(this.header.hashType);
    return this.readPromise().then(innerStream => {
      innerStream.pipe(hashStream);
      return bottle_stream.readBottleFromStream(hashStream).then(innerBottle => {
        const hashPromise = innerBottle.endPromise().then(() => {
          return this.readPromise().then(digestStream => {
            return toolkit.pipeToBuffer(digestStream).then((digestBuffer) => {
              return digestBuffer.toString("hex");
            });
          });
        });
        const validPromise = hashPromise.then((hex) => {
          return hex == hashStream.digest.toString("hex");
        });
        return { bottle: innerBottle, valid: validPromise, hex: hashPromise };
      });
    });
  }
}
