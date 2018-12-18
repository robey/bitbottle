import * as argon2 from "argon2";
import * as crypto from "crypto";
import { Decorate, Stream } from "ballvalve";
import { Bottle, BottleType } from "./bottle";
import { Header } from "./header";

export enum Encryption {
  AES_256_GCM = 0,
}

const NAME = {
  [Encryption.AES_256_GCM]: "AES-256-GCM",
};

enum Field {
  IntEncryptionType = 0,
  StringRecipients = 0,
  StringArgon2iParameters = 1,
}

// switch to a new key every 1GB at least
const DEFAULT_MAX_STREAM_SIZE = Math.pow(1, 9);

export interface EncryptionOptions {
  // when should we switch to a new key?
  maxStreamSize?: number;

  // used as the initial argon2 seed:
  // if using recipients/encrypter, this should be from `crypto.randomBytes`.
  // otherwise it should be a passphrase.
  key: Buffer;

  // if present, we will use `encrypter` to encrypt the key for each recipient:
  recipients?: string[];
  encrypter?: (recipient: string, key: Buffer) => Promise<Buffer>;

  // if you want to change the argon difficulty level:
  argonTimeCost?: number;
  argonMemoryCost?: number;
  argonParallelism?: number;
  argonSalt?: Buffer;
}

// default argon2i parameters:
const DEFAULT_ARGON_TIMECOST = 3;
const DEFAULT_ARGON_MEMORYCOST = 4096;
const DEFAULT_ARGON_PARALLELISM = 1;

// turn several fields into mandatory
export interface FullArgonOptions extends argon2.Options {
  raw: true;
  timeCost: number;
  memoryCost: number;
  parallelism: number;
  salt: Buffer;
}

interface CryptoParams {
  cipherName: crypto.CipherGCMTypes;
  keyLength: number;
  ivLength: number;
}


export class EncryptedBottle {
  private constructor(public bottle: Bottle, public stream: Stream) {
    // pass
  }

  static write(type: Encryption, stream: Stream, options: EncryptionOptions): Stream {
    const argonOptions: FullArgonOptions = {
      raw: true,
      timeCost: options.argonTimeCost || DEFAULT_ARGON_TIMECOST,
      memoryCost: options.argonMemoryCost || DEFAULT_ARGON_MEMORYCOST,
      parallelism: options.argonParallelism || DEFAULT_ARGON_PARALLELISM,
      salt: options.argonSalt || crypto.randomBytes(16),
    };

    const header = new Header();
    header.addInt(Field.IntEncryptionType, type);
    if (options.recipients && options.recipients.length > 0) {
      header.addStringList(Field.StringRecipients, options.recipients);
    }
    header.addStringList(Field.StringArgon2iParameters, argonOptionsToList(argonOptions));

    let params: CryptoParams;
    switch (type) {
      case Encryption.AES_256_GCM:
        params = { cipherName: "aes-256-gcm", keyLength: 32, ivLength: 16 };
        break;
      default:
        throw new Error("Unknown encryption");
    }

    const maxSize = options.maxStreamSize || DEFAULT_MAX_STREAM_SIZE;
    const encryptedStreams = encryptStream(stream, params, options.key, maxSize, argonOptions);
    const outStreams = Decorate.asyncIterator(writeKeys(options)).chain(encryptedStreams);
    return Bottle.write(BottleType.Encrypted, header, outStreams);
  }
}

async function* writeKeys(options: EncryptionOptions): AsyncIterator<Stream> {
  if (!options.recipients || options.recipients.length == 0 || !options.encrypter) return;
  for (const r of options.recipients) {
    yield Decorate.iterator([ await options.encrypter(r, options.key) ]);
  }
}

async function* encryptStream(
  wrapped: Stream,
  params: CryptoParams,
  keyData: Buffer,
  maxBytes: number,
  argonOptions: FullArgonOptions
): AsyncIterator<Stream> {
  const options = Object.assign({ hashLength: params.keyLength + params.ivLength }, argonOptions);

  // generate a new pair of streams for each `maxBytes` bytes.
  while (true) {
    // use argon to generate a new key/iv and a new EncryptedStream
    keyData = await argon2.hash(keyData, options);
    const key = keyData.slice(0, params.keyLength);
    const iv = keyData.slice(params.ivLength);
    const cipher = crypto.createCipheriv(params.cipherName, key, iv);
    const s = new EncryptedStream(wrapped, cipher, maxBytes);
    yield s;

    // a separate stream for the auth tag
    yield Decorate.iterator([ cipher.getAuthTag() ]);

    if (s.finished) return;
  }
}

class EncryptedStream implements Stream {
  finished = false;
  limited = false;
  bytes = 0;

  constructor(public wrapped: Stream, public cipher: crypto.CipherGCM, public maxBytes: number) {
    // pass
  }

  async next(): Promise<IteratorResult<Buffer>> {
    if (this.finished) return { done: true } as IteratorResult<Buffer>;
    if (this.bytes >= this.maxBytes) {
      this.limited = true;
      this.finished = true;
      return { done: false, value: this.cipher.final() };
    }
    const item = await this.wrapped.next();
    if (item.done || item.value === undefined) {
      this.finished = true;
      return { done: false, value: this.cipher.final() };
    }
    this.bytes += item.value.length;
    return { done: false, value: this.cipher.update(item.value) };
  }
}



// export function decodeEncryptionHeader(h) {
//   const rv = {};
//   h.fields.forEach(field => {
//     switch (field.type) {
//       case TYPE_ZINT:
//         switch (field.id) {
//           case FIELDS.NUMBERS.ENCRYPTION_TYPE:
//             rv.encryptionType = field.number;
//             break;
//         }
//         break;
//       case TYPE_STRING:
//         switch (field.id) {
//           case FIELDS.STRINGS.RECIPIENTS:
//             rv.recipients = field.list;
//             break;
//           case FIELDS.STRINGS.SCRYPT:
//             rv.scrypt = field.string.split(":");
//             break;
//         }
//         break;
//     }
//   });
//   if (rv.encryptionType == null) rv.encryptionType = ENCRYPTION_AES_256_CTR;
//   rv.encryptionName = ENCRYPTION_NAMES[rv.encryptionType];
//   return rv;
// }

// /*
//  * Options:
//  *   - `key`: `Buffer` the key to use for decryption, if you have one already
//  *   - `decrypter`: `(keymap: Map(String, Buffer)) => Promise(Buffer)`
//  *     function to generate an decrypted key, given a map of recipients to
//  *     encrypted keys
//  *   - `getPassword`: `() => Promise(String)` requested when the key is
//  *     encrypted with scrypt
//  */
// export function readEncryptedBottle(header, bottleReader, options = {}) {
//   const decrypter = options.decrypter || (() => Promise.reject(new Error("No decrypter given")));
//   const getPassword = options.getPassword || (() => Promise.reject(new Error("No getPassword given")));

//   return readKeys(header, bottleReader).then(keymap => {
//     return decodeKey(options.key, keymap, header.scrypt, decrypter, getPassword).then(key => {
//       const stream = decryptedStreamForType(header.encryptionType, key);
//       return bottleReader.readPromise().then(innerStream => {
//         innerStream.pipe(stream);
//         return stream;
//       });
//     });
//   });
// }

// /*
//  * if the header lists recipients, read the Map of recipient names to
//  * encrypted keys, and return it.
//  */
// function readKeys(header, bottleReader) {
//   const keyMap = new Map();
//   return Promise.all(
//     Promise.map(header.recipients || [], recipient => {
//       return bottleReader.readPromise().then(innerStream => {
//         return pipeToBuffer(innerStream).then(buffer => {
//           keyMap.set(recipient, buffer);
//         });
//       });
//     }, { concurrency: 1 })
//   ).then(() => keyMap);
// }

// function decodeKey(key, keymap, params, decrypter, getPassword) {
//   if (key) return Promise.resolve(key);
//   if (keymap.size > 0) return Promise.try(() => decrypter(keymap));
//   if (!params || params.length != 4) throw new Error("No key, no keymap, and no scrypt parameters");

//   const [ n, r, p, salt ] = params;
//   return Promise.try(() => getPassword()).then(password => {
//     return scrypt.hashSync(password, new Buffer(salt, "base64"), {
//       cost: Math.pow(2, parseInt(n, 10)),
//       blockSize: parseInt(r, 10),
//       parallel: parseInt(p, 10)
//     });
//   });
// }

// function decryptedStreamForType(encryptionType, keyBuffer) {
//   switch (encryptionType) {
//     case ENCRYPTION_AES_256_CTR:
//       const key = keyBuffer.slice(0, 32);
//       const iv = keyBuffer.slice(32, 48);
//       return crypto.createDecipheriv("aes-256-ctr", key, iv);
//     default:
//       throw new Error(`Unknown encryption type: ${encryptionType}`);
//   }
// }


// argon2i parameters are a string list: timeCost, memoryCost, parallelism, salt
function argonListToOptions(list: string[]): FullArgonOptions {
  return {
    raw: true,
    timeCost: parseInt(list[0], 10),
    memoryCost: parseInt(list[1], 10),
    parallelism: parseInt(list[2], 10),
    salt: Buffer.from(list[3], "base64"),
  };
}

function argonOptionsToList(options: FullArgonOptions): string[] {
  return [
    options.timeCost.toString(),
    options.memoryCost.toString(),
    options.parallelism.toString(),
    options.salt.toString("base64")
  ];
}
