import * as argon2 from "argon2";
import * as crypto from "crypto";
import { Bottle } from "./bottle";
import { BottleCap, BottleType } from "./bottle_cap";
import { Header } from "./header";
import { byteReader, asyncIter } from "ballvalve";
import { asyncOne } from "./async";

interface CryptoParams {
  cipherName: crypto.CipherGCMTypes;
  keyLength: number;
  ivLength: number;
  hashLength: number;
}

export enum Encryption {
  AES_128_GCM = 0,
}

const NAME = {
  [Encryption.AES_128_GCM]: "AES-128-GCM",
};

const PARAMS: { [id: number]: CryptoParams } = {
  [Encryption.AES_128_GCM]: { cipherName: "aes-128-gcm", keyLength: 16, ivLength: 16, hashLength: 16 },
};

enum Field {
  IntEncryptionType = 0,
  IntBlockSizeBits = 1,
  StringRecipients = 0,
  StringArgon2iParameters = 1,
}

// (power of 2) we have to buffer this much data, so don't go crazy here.
const MIN_BLOCK_SIZE = 16 * 1024;  // 16KB
const DEFAULT_BLOCK_SIZE = 64 * 1024;  // 64KB
const MAX_BLOCK_SIZE = 1024 * 1024;  // 1MB

// default argon2i parameters:
const DEFAULT_ARGON_TIME_COST = 3;
const DEFAULT_ARGON_MEMORY_COST = 4096;
const DEFAULT_ARGON_PARALLELISM = 1;

export interface EncryptionOptions {
  encryption?: Encryption;

  // (power of 2) how much should we buffer before computing a hash and switching the IV (nonce)?
  encryptionBlockSize?: number;

  // use argon to generate the key?
  argonKey?: Buffer;
  // otherwise, pass in random bytes to use as the key?
  key?: Buffer;
  // if neither, we'll generate a random key.

  // if present, we will use `encrypter` to encrypt the key for each recipient:
  recipients?: string[];
  encrypter?: (recipient: string, key: Buffer) => Promise<Buffer>;

  // if you want to change the argon difficulty level:
  argonTimeCost?: number;
  argonMemoryCost?: number;
  argonParallelism?: number;
  argonSalt?: Buffer;
}

export interface EncryptReadOptions {
  // given a map of recipients to encrypted keys, find one that you can decrypt and return the decrypted key
  decryptKey?: (keys: Map<string, Buffer>) => Promise<Buffer>;

  // if encrypted with argon, ask for the password
  getPassword?: () => Promise<Buffer>;

  // if it's just a raw key, supply it
  getKey?: () => Promise<Buffer>;
}

// turn several fields into mandatory
export interface FullArgonOptions extends argon2.Options {
  raw: true;
  timeCost: number;
  memoryCost: number;
  parallelism: number;
  salt: Buffer;
}

export interface HeaderOptions {
  method: Encryption;
  blockSizeBits: number;
  recipients?: string[];
  argonOptions?: FullArgonOptions;
}

export enum DecryptStatus {
  OK = 0,
  NO_RECIPIENT = 1,  // didn't get a decrypted key from `decryptKey`
  NEED_PASSWORD = 2,
  NEED_KEY = 3,
}

export interface EncryptionInfo {
  method: Encryption;
  status: DecryptStatus;
  recipients?: string[];
  reason?: string;
}

export interface DecryptedBottle {
  info: EncryptionInfo;
  bottle?: Bottle;
}


export async function writeEncryptedBottle(bottle: AsyncIterator<Buffer>, options: EncryptionOptions = {}): Promise<Bottle> {
  const method = options.encryption ?? Encryption.AES_128_GCM;
  if (options.recipients && !options.encrypter) throw new Error("Can't use recipients without encrypter");

  let blockSize = options.encryptionBlockSize ?? DEFAULT_BLOCK_SIZE;
  if (blockSize < MIN_BLOCK_SIZE || blockSize > MAX_BLOCK_SIZE) {
    throw new Error("Invalid block size");
  }
  const blockSizeBits = Math.round(Math.log2(blockSize));
  blockSize = Math.pow(2, blockSizeBits);

  const argonOptions: FullArgonOptions = {
    raw: true,
    timeCost: options.argonTimeCost ?? DEFAULT_ARGON_TIME_COST,
    memoryCost: options.argonMemoryCost ?? DEFAULT_ARGON_MEMORY_COST,
    parallelism: options.argonParallelism ?? DEFAULT_ARGON_PARALLELISM,
    salt: options.argonSalt ?? crypto.randomBytes(16),
  };

  const cap = new BottleCap(BottleType.ENCRYPTED, encodeHeader({
    method,
    blockSizeBits,
    recipients: options.recipients,
    argonOptions: options.argonKey ? argonOptions : undefined
  }));
  const params = PARAMS[method];

  let key: Buffer;
  if (options.key) {
    key = options.key;
  } else if (options.argonKey) {
    key = await argon2.hash(options.argonKey, Object.assign({
      type: "argon2i",
      hashLength: params.keyLength,
    }, argonOptions));
  } else {
    key = crypto.randomBytes(params.keyLength);
  }

  let encrypted = encryptStream(bottle, method, key, blockSize);
  let streams = asyncIter(writeKeys(key, options)).chain(asyncIter(asyncOne(encrypted)));
  return new Bottle(cap, streams);
}

export async function readEncryptedBottle(bottle: Bottle, options: EncryptReadOptions): Promise<DecryptedBottle> {
  if (bottle.cap.type != BottleType.ENCRYPTED) throw new Error("Not an encrypted bottle");
  const headerOptions = decodeHeader(bottle.cap.header);
  const method = headerOptions.method;
  const params = PARAMS[headerOptions.method];

  let key: Buffer;
  if (headerOptions.recipients) {
    const recipients = headerOptions.recipients;
    const keys = await readKeys(bottle, recipients);
    if (!options.decryptKey) return { info: { method, status: DecryptStatus.NO_RECIPIENT, recipients } };
    try {
      key = await options.decryptKey(keys);
    } catch (error) {
      return { info: { method, status: DecryptStatus.NO_RECIPIENT, recipients, reason: error.message.toString() } };
    }
  } else if (headerOptions.argonOptions) {
    if (!options.getPassword) return { info: { method, status: DecryptStatus.NEED_PASSWORD } };
    try {
      key = await argon2.hash(await options.getPassword(), Object.assign({
        type: "argon2i",
        hashLength: params.keyLength,
      }, headerOptions.argonOptions));
    } catch (error) {
      return { info: { method, status: DecryptStatus.NEED_PASSWORD, reason: error.message.toString() } };
    }
  } else {
    if (!options.getKey) return { info: { method, status: DecryptStatus.NEED_KEY } };
    try {
      key = await options.getKey();
    } catch (error) {
      return { info: { method, status: DecryptStatus.NEED_KEY, reason: error.message.toString() } };
    }
  }

  const blockSize = Math.pow(2, headerOptions.blockSizeBits);
  const s = decryptStream(await bottle.nextDataStream(), headerOptions.method, key, blockSize);
  return { info: { method, status: DecryptStatus.OK }, bottle: await Bottle.read(byteReader(s)) };
}

function encodeHeader(h: HeaderOptions): Header {
  const header = new Header();
  header.addInt(Field.IntEncryptionType, h.method);
  header.addInt(Field.IntBlockSizeBits, h.blockSizeBits);
  if (h.recipients) header.addString(Field.StringRecipients, h.recipients.join(","));
  if (h.argonOptions) header.addString(Field.StringArgon2iParameters, argonOptionsToList(h.argonOptions));
  return header;
}

function decodeHeader(header: Header): HeaderOptions {
  const method = header.getInt(Field.IntEncryptionType) ?? Encryption.AES_128_GCM;
  const blockSizeBits = header.getInt(Field.IntBlockSizeBits) ?? 16;
  const recipients = header.getString(Field.StringRecipients)?.split(",");
  const argonOptions = argonListToOptions(header.getString(Field.StringArgon2iParameters));
  return { method, blockSizeBits, recipients, argonOptions };
}

async function* writeKeys(key: Buffer, options: EncryptionOptions): AsyncIterator<AsyncIterator<Buffer>> {
  if (!options.recipients || options.recipients.length == 0 || !options.encrypter) return;
  for (const r of options.recipients) {
    yield asyncOne(await options.encrypter(r, key));
  }
}

// if there are recipients, read the various encrypted keys and put them
// into a Map of (recipient -> encrypted key).
async function readKeys(bottle: Bottle, recipients: string[]): Promise<Map<string, Buffer>> {
  const keyMap = new Map<string, Buffer>();
  for (const recipient of recipients) {
    keyMap.set(recipient, Buffer.concat(await asyncIter(await bottle.nextDataStream()).collect()));
  }
  return keyMap;
}

// argon2i parameters are a string list: timeCost, memoryCost, parallelism, salt
function argonListToOptions(params?: string): FullArgonOptions | undefined {
  if (params === undefined) return undefined;
  const list = params.split(",");
  if (list.length != 4) throw new Error("bad argon params");
  return {
    raw: true,
    timeCost: parseInt(list[0], 10),
    memoryCost: parseInt(list[1], 10),
    parallelism: parseInt(list[2], 10),
    salt: Buffer.from(list[3], "base64"),
  };
}

function argonOptionsToList(options: FullArgonOptions): string {
  return [
    options.timeCost.toString(),
    options.memoryCost.toString(),
    options.parallelism.toString(),
    options.salt.toString("base64")
  ].join(",");
}

// each block is preceded by [ iv, hash ]
export async function* encryptStream(
  stream: AsyncIterator<Buffer>,
  method: Encryption,
  key: Buffer,
  blockSize: number,
): AsyncIterator<Buffer> {
  const params = PARAMS[method];
  const reader = byteReader(stream);

  while (true) {
    const buffer = await reader.read(blockSize);
    if (buffer === undefined) return;

    const iv = crypto.randomBytes(params.ivLength);
    const cipher = crypto.createCipheriv(params.cipherName, key, iv);
    const out1 = cipher.update(buffer);
    const out2 = cipher.final();
    const hash = cipher.getAuthTag();
    yield* [ iv, hash, out1, out2 ];
  }
}

export async function* decryptStream(
  stream: AsyncIterator<Buffer>,
  method: Encryption,
  key: Buffer,
  blockSize: number,
): AsyncIterator<Buffer> {
  const params = PARAMS[method];
  const reader = byteReader(stream);

  while (true) {
    const iv = await reader.read(params.ivLength);
    if (!iv) return;
    if (iv.length < params.ivLength) throw new Error("truncated stream");
    const hash = await reader.read(params.hashLength);
    if (!hash || hash.length < params.hashLength) throw new Error("truncated stream");
    const buffer = await reader.read(blockSize);
    if (!buffer) throw new Error("truncated stream");

    const cipher = crypto.createDecipheriv(params.cipherName, key, iv);
    const out1 = cipher.update(buffer);
    cipher.setAuthTag(hash);
    // this will throw if the auth tag was wrong:
    const out2 = cipher.final();
    yield* [ out1, out2 ];
  }
}
