import * as crypto from "crypto";
import { Decorate, Stream, AsyncIterableOnce } from "ballvalve";
import { debug } from "./debug";
import { Header } from "./header";
import { Bottle, BottleReader, BottleType } from "./bottle";

export enum Hash {
  SHA512 = 0
}

const NAME = {
  [Hash.SHA512]: "SHA-512"
};

const HASH = {
  [Hash.SHA512]: "sha512"
};

enum Field {
  IntHashType = 0,
  StringSignedBy = 0,
}

export interface HashOptions {
  // if the hash should be signed, who was it signed by?
  signedBy?: string;

  // sign the digest and return a signed buffer that contains the digest inside
  signer?: (digest: Buffer) => Promise<Buffer>;
}

export class HashBottle {
  static write(type: Hash, stream: Stream, options: HashOptions = {}): Stream {
    const header = new Header();
    header.addInt(Field.IntHashType, type);
    if (options.signedBy) header.addString(Field.StringSignedBy, options.signedBy);

    async function* streams() {
      const hasher = new HashingStream(stream, HASH[type] || HASH[Hash.SHA512]);
      yield hasher;

      const digest = options.signer ? await options.signer(hasher.digest()) : hasher.digest();
      yield Decorate.iterator([ digest ]);
    }

    return Bottle.write(BottleType.Hashed, header, streams());
  }
}

// export function writeHashBottle(type: Hash, stream: Stream, options: HashOptions = {}): Stream {

//   const task = new BackgroundTask<Buffer, void>(bottle);

//   // FIXME: filler func
//   task.run(async () => {
//     await bottle.push(hasher);
//     const digest = options.signer ? await options.signer(hasher.digest) : hasher.digest;
//     await bottle.push(asyncIterable([ digest ]));
//     bottle.end();
//   });
//   return task;
// }

// export async function readHashBottle(reader: BottleReader): Promise<BackgroundTask<Buffer, Buffer>> {
//   const item1 = await reader.next();
//   if (item1.done || item1.value === undefined) throw new Error("Truncated hash stream");
//   const stream = new HashingStream(item1.value, HASH[reader.bottle.header.getInt(Field.IntHashType) || Hash.SHA512]);
// }

// class HashBottleReader implements Stream, AsyncIterator<Buffer> {
//   iter: AsyncIterator<Stream | BottleReader>;

//   constructor(public reader: BottleReader) {
//     this.iter = reader[Symbol.asyncIterator]();
//   }

//   async start() {
//     const item = await this.next();
//     if (item.done || item.)
//     const hasher = new HashingStream(iter.next())
//   }

//   [Symbol.asyncIterator]() {
//     return this;
//   }

//   next(): Promise<IteratorResult<Buffer>> {

//   }
// }




//   const hashStream = hashStreamForType(header.hashType);
//   if (header.signedBy && !options.verifier) throw new Error("No verifier given");
//   const _babel_bug = buffer => Promise.resolve(buffer);
//   const verifier = options.verifier || _babel_bug;

//   return bottleReader.readPromise().then(stream => {
//     if (!stream) throw new Error("Premature end of stream");
//     stream.pipe(hashStream);


// /*
//  * Produle a bottle that hashes (and optionally signs) a stream.
//  *
//  * Options:
//  *   - signedBy: `String` if the hash should be signed, who was it signed by
//  *   - signer: `Buffer => Promise(Buffer)`: perform the signing, and
//  *     return a signed blob that contains the original buffer inside it
//  *
// export function writeHashBottle(hashType, options = {}) {
//   const _babel_bug = hash => Promise.resolve(hash);
//   const signer = options.signer || _babel_bug;

//   const header = new Header();
//   header.addNumber(FIELDS.NUMBERS.HASH_TYPE, hashType);
//   if (options.signedBy) header.addString(FIELDS.STRINGS.SIGNED_BY, options.signedBy);

//   const bottle = writeBottle(TYPE_HASHED, header);
//   const writer = hashStreamForType(hashType);
//   bottle.write(writer);
//   writer.on("end", () => {
//     return Promise.try(() => signer(writer.digest)).then(hashData => {
//       bottle.write(sourceStream(hashData));
//       bottle.end();
//     }, error => bottle.emit("error", error));
//   });
//   return Promise.resolve({ writer, bottle });
// }


class HashingStream implements Stream {
  hasher: crypto.Hash;

  constructor(public wrapped: Stream, public hashName: string) {
    this.hasher = crypto.createHash(hashName);
  }

  toString(): string {
    return `HashingStream(${this.hashName}, ${this.wrapped.toString()})`;
  }

  async next(): Promise<IteratorResult<Buffer>> {
    const item = await this.wrapped.next();
    if (!item.done && item.value !== undefined) this.hasher.update(item.value);
    return item;
  }

  digest(): Buffer {
    return this.hasher.digest();
  }
}


// // -----

// export function decodeHashHeader(h) {
//   const rv = {};
//   h.fields.forEach(field => {
//     switch (field.type) {
//       case TYPE_ZINT:
//         switch (field.id) {
//           case FIELDS.NUMBERS.HASH_TYPE:
//             rv.hashType = field.number;
//             break;
//         }
//         break;
//       case TYPE_STRING:
//         switch (field.id) {
//           case FIELDS.STRINGS.SIGNED_BY:
//             rv.signedBy = field.string;
//             break;
//         }
//         break;
//     }
//   });
//   if (rv.hashType == null) rv.hashType = HASH_SHA512;
//   rv.hashName = HASH_NAMES[rv.hashType];
//   return rv;
// }

// /*
//  * Returns a promise containing:
//  *   - stream: inner stream
//  *   - hexPromise: promise for a hex of the hash, resolved if it matched or
//  *     was signed correctly (rejected if not)
//  *
//  * Options:
//  *   - `verifier`: `(Buffer, signedBy: String) => Promise(Buffer)`: if the
//  *     hash was signed, unpack the signature, verify that it was signed by
//  *     `signedBy`, and return either the signed data or an exception
//  *
// export function readHashBottle(header, bottleReader, options = {}) {
//   const hashStream = hashStreamForType(header.hashType);
//   if (header.signedBy && !options.verifier) throw new Error("No verifier given");
//   const _babel_bug = buffer => Promise.resolve(buffer);
//   const verifier = options.verifier || _babel_bug;

//   return bottleReader.readPromise().then(stream => {
//     if (!stream) throw new Error("Premature end of stream");
//     stream.pipe(hashStream);

//     const hexPromise = new Promise((resolve, reject) => {
//       hashStream.endPromise().then(() => {
//         return bottleReader.readPromise().then(digestStream => {
//           if (!digestStream) throw new Error("Premature end of stream");
//           return pipeToBuffer(digestStream).then(signedBuffer => {
//             return header.signedBy ? verifier(signedBuffer, header.signedBy) : signedBuffer;
//           }).then(digestBuffer => {
//             if (!digestBuffer) digestBuffer = new Buffer(0);
//             const realHex = hashStream.digest.toString("hex");
//             const gotHex = digestBuffer.toString("hex");
//             if (realHex == gotHex) {
//               resolve(gotHex);
//             } else {
//               reject(new Error(`Incorrect hash (expected ${realHex}, got ${gotHex})`));
//             }
//           });
//         });
//       }).catch(error => {
//         reject(error);
//       });
//     });

//     return { stream: hashStream, hexPromise };
//   });
// }


// wrap a stream with a background task that will resolve `done` when complete.
class BackgroundTask<A, B> implements AsyncIterable<A>, AsyncIterator<A> {
  result: Promise<B>;

  private wrapped: AsyncIterator<A>;
  private resolve?: (value: B) => void;
  private reject?: (e: Error) => void;

  constructor(s: AsyncIterable<A>) {
    this.wrapped = s[Symbol.asyncIterator]();
    this.result = new Promise<B>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  async next(): Promise<IteratorResult<A>> {
    return await this.wrapped.next();
  }

  run(f: () => Promise<B>) {
    (async () => {
      try {
        const rv = await f();
        if (this.resolve) this.resolve(rv);
      } catch (error) {
        debug(`Error in background task:`);
        (error.stack as string).split("\n").forEach(line => debug(line));
        if (this.reject) this.reject(error);
      }
    })();
  }
}
