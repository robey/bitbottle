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
  // (power of 2) how much should we buffer before computing a hash and switching the IV (nonce)?
  blockSize?: number;

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

export class DecryptionRequiredError extends Error {
  constructor(public recipients: string[]) {
    super("Encrypted for private recipient(s)");
  }
}

export class PasswordRequiredError extends Error {
  constructor() {
    super("Password required");
  }
}

export class KeyRequiredError extends Error {
  constructor() {
    super("Key required");
  }
}


export async function writeEncryptedBottle(
  method: Encryption,
  bottle: Bottle,
  options: EncryptionOptions
): Promise<Bottle> {
  if (options.recipients && !options.encrypter) throw new Error("Can't use recipients without encrypter");

  if (options.blockSize !== undefined && (options.blockSize < MIN_BLOCK_SIZE || options.blockSize > MAX_BLOCK_SIZE)) {
    throw new Error("Invalid block size");
  }
  const blockSizeBits = Math.round(Math.log2(options.blockSize ?? DEFAULT_BLOCK_SIZE));
  const blockSize = Math.pow(2, blockSizeBits);
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

  let encrypted = encryptStream(bottle.write(), method, key, blockSize);
  let streams = asyncIter(writeKeys(key, options)).chain(asyncIter(asyncOne(encrypted)));
  return new Bottle(cap, streams);
}

export async function readEncryptedBottle(bottle: Bottle, options: EncryptReadOptions): Promise<Bottle> {
  if (bottle.cap.type != BottleType.ENCRYPTED) throw new Error("Not an encrypted bottle");
  const headerOptions = decodeHeader(bottle.cap.header);
  const params = PARAMS[headerOptions.method];

  let key: Buffer;
  if (headerOptions.recipients) {
    const keys = await readKeys(bottle, headerOptions.recipients);
    const decrypter = options.decryptKey ??
      (_ => { throw new DecryptionRequiredError(headerOptions.recipients || []) });
    key = await decrypter(keys);
  } else if (headerOptions.argonOptions) {
    const password = await (options.getPassword ?? (() => { throw new PasswordRequiredError() }))();
    key = await argon2.hash(password, Object.assign({
      type: "argon2i",
      hashLength: params.keyLength,
    }, headerOptions.argonOptions));
  } else {
    key = await (options.getKey ?? (() => { throw new KeyRequiredError() }))();
  }

  const blockSize = Math.pow(2, headerOptions.blockSizeBits);
  const s = decryptStream(await bottle.nextDataStream(), headerOptions.method, key, blockSize);
  return await Bottle.read(byteReader(s));
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
