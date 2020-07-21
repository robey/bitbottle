import { asyncIter, byteReader } from "ballvalve";
import * as crypto from "crypto";
import { asyncify, asyncOnePromise } from "./async";
import { Bottle } from "./bottle";
import { BottleCap, BottleType } from "./bottle_cap";
import { Header } from "./header";

export enum Hash {
  SHA256 = 0,
}

enum Field {
  IntHashType = 0,
  StringSignedBy = 0,
}

const CRYPTO_NAME = {
  [Hash.SHA256]: "sha256"
};


export interface SignOptions {
  // if the hash should be signed, who was it signed by?
  signedBy?: string;

  // sign the digest and return a signed buffer that contains the digest inside
  signer?: (digest: Buffer) => Promise<Buffer>;
}

export interface VerifyOptions {
  // verify the signature and either return the signed data, or throw an error
  verifier?: (signedDigest: Buffer, signedBy: string) => Promise<Buffer>;
}

// a signed Bottle, and a promise that tells you whether the signature/hash was valid
export interface VerifiedBottle {
  bottle: Bottle;

  // after the bottle has been completely read, this promise will either:
  //   - resolve: the hash (and possibly signature) was valid
  //   - reject: the signature was bad, or the hash was bad
  valid: Promise<void>;
}


export async function writeSignedBottle(method: Hash, bottle: Bottle, options: SignOptions = {}): Promise<Bottle> {
  const header = new Header();
  header.addInt(Field.IntHashType, method);
  if (options.signedBy) header.addString(Field.StringSignedBy, options.signedBy);
  const cap = new BottleCap(BottleType.SIGNED, header);

  const [ digest, stream ] = computeHash(bottle.write(), CRYPTO_NAME[method]);
  const signedDigest = digest.then(d => options.signer ? options.signer(d) : d);
  return new Bottle(cap, asyncify([ stream, asyncOnePromise(signedDigest) ]));
}

export async function readSignedBottle(bottle: Bottle, options: VerifyOptions = {}): Promise<VerifiedBottle> {
  if (bottle.cap.type != BottleType.SIGNED) throw new Error("Not a signed bottle");
  const method: Hash = bottle.cap.header.getInt(Field.IntHashType) ?? Hash.SHA256;
  const signedBy = bottle.cap.header.getString(Field.StringSignedBy);

  const stream = await bottle.nextDataStream();
  const [ digest, stream2 ] = computeHash(stream, CRYPTO_NAME[method]);

  const valid = (async () => {
    const d = await digest;
    let signedDigest = Buffer.concat(await asyncIter(await bottle.nextDataStream()).collect());
    if (signedBy && options.verifier) {
      signedDigest = await options.verifier(signedDigest, signedBy);
    }
    if (!d.equals(signedDigest)) {
      throw new Error(`Mismatched digest: expected ${d.toString("hex")}, got ${signedDigest.toString("hex")}`);
    }
  })();

  return { bottle: await Bottle.read(byteReader(stream2)), valid };
}

// somewhat awkward way to collect the hash of a stream as it passes through.
function computeHash(stream: AsyncIterator<Buffer>, name: string): [ Promise<Buffer>, AsyncIterator<Buffer> ] {
  let setHash: (b: Buffer) => void = _ => 0;
  const hash = new Promise<Buffer>(resolve => setHash = resolve);

  const hasher = crypto.createHash(name);
  const passThrough = async function* (): AsyncIterator<Buffer> {
    for await (const b of asyncIter(stream)) {
      hasher.update(b);
      yield b;
    }
    setHash(hasher.digest());
  };

  return [ hash, passThrough() ];
}
