import { Decorate, Stream } from "ballvalve";
import * as crypto from "crypto";
import { debug } from "./debug";
import { Header } from "./header";
import { Bottle, BottleType } from "./bottle";

export enum Hash {
  SHA512 = 0,
  // for decoding:
  MIN = 0,
  MAX = 0,
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
  private constructor(public bottle: Bottle, public stream: HashingStream) {
    // pass
  }

  // call after draining the main stream.
  // if the stream was signed, a verifier must be supplied to verify the
  // signature and return the original buffer (or throw an exception).
  // returns the hash if it was valid; throws an exception otherwise.
  async check(verifier?: (hash: Buffer, signedBy: string) => Promise<Buffer>): Promise<Buffer> {
    const hash = this.stream.digest();
    const signedBy = this.bottle.cap.header.getString(Field.StringSignedBy);
    if (signedBy && !verifier) throw new Error("No verifier given for signed HashBottle");

    const signedBuffer = Buffer.concat(await Decorate.asyncIterator(await this.bottle.nextStream()).collect());
    const digestBuffer = signedBy && verifier ? (await verifier(signedBuffer, signedBy)) : signedBuffer;
    if (!digestBuffer.equals(hash)) {
      throw new Error(`Incorrect hash: expected ${hash.toString("hex")}, got ${digestBuffer.toString("hex")}`);
    }

    await this.bottle.assertEndOfStreams();
    return hash;
  }

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

  static async read(bottle: Bottle): Promise<HashBottle> {
    const hashType: Hash = bottle.cap.header.getInt(Field.IntHashType) || 0;
    if (hashType < Hash.MIN || hashType > Hash.MAX) throw new Error(`Unknown hash type ${hashType}`);

    const innerStream = await bottle.nextStream();
    const hasher = new HashingStream(innerStream, HASH[hashType] || HASH[Hash.SHA512]);
    return new HashBottle(bottle, hasher);
  }
}


export class HashingStream implements Stream {
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
