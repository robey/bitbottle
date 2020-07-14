import { byteReader } from "ballvalve";
import * as crypto from "crypto";
import { asyncOne, asyncify } from "../async";
import { Bottle } from "../bottle";
import { BottleCap, BottleType } from "../bottle_cap";
import { decryptStream, Encryption, encryptStream, readEncryptedBottle, writeEncryptedBottle } from "../encrypted_bottle";
import { Header } from "../header";
import { drain, fromHex } from "./tools";

import "should";
import "source-map-support/register";

const LONG_STRING = "Time can stand still inside my funeral home / And the things I do, not set in stone / Oh the bright ideas / In the dark when you feel oh so cold";

describe("encrypted stream", () => {
  it("aes-128-gcm", async () => {
    const key = Buffer.from("all i ever knew.");
    const s1 = encryptStream(asyncOne(Buffer.from(LONG_STRING)), Encryption.AES_128_GCM, key, 32);
    const out = await drain(s1);
    out.length.should.eql(Math.ceil(LONG_STRING.length / 32) * 32 + LONG_STRING.length);

    const s2 = decryptStream(asyncOne(out), Encryption.AES_128_GCM, key, 32);
    const text = await drain(s2);
    text.length.should.eql(LONG_STRING.length);
    text.toString().should.eql(LONG_STRING);
  });

  // seems to not matter.
  // it("compare 16k -> 1M block sizes", async () => {
  //   const key = Buffer.from("all i ever knew.");
  //   const data = Buffer.alloc(Math.pow(2, 20));

  //   for (let round = 0; round < 10; round++) {
  //     const timings: number[] = [];
  //     for (let bits = 14; bits <= 20; bits++) {
  //       const blockSize = Math.pow(2, bits);
  //       const start = process.hrtime();
  //       await drain(encryptStream(asyncOne(data), Encryption.AES_128_GCM, key, 32));
  //       const elapsed = process.hrtime(start);
  //       timings.push(elapsed[0] * 1_000 + elapsed[1] / 1_000_000);
  //       console.log(".")
  //     }
  //     console.log("Timings:", timings.join(", "));
  //   }
  // });
});


describe("EncryptedBottle", () => {
  const CAP_14 = new BottleCap(14, new Header());

  describe("encrypts AES_128_GCM", () => {
    it("with key", async () => {
      const options = { key: Buffer.alloc(16), blockSize: 65536 };
      const clearBottle = new Bottle(CAP_14, asyncify([ fromHex("68656c6c6f") ]));
      const bottle = await writeEncryptedBottle(Encryption.AES_128_GCM, clearBottle, options);

      // read it out manually
      const b = await Bottle.read(byteReader(bottle.write()));
      b.cap.type.should.eql(BottleType.ENCRYPTED);
      b.cap.header.toString().should.eql("Header(U8(0)=0, U8(1)=16)");

      const s = decryptStream(await b.nextDataStream(), Encryption.AES_128_GCM, options.key, options.blockSize);
      const b2 = await Bottle.read(byteReader(s));

      b2.cap.type.should.eql(14);
      b2.cap.header.toString().should.eql("Header()");
      (await drain(await b2.nextDataStream())).toString().should.eql("hello");

      await b2.done();
      await b.done();
    });

    it("round trip with key", async () => {
      const options = { key: Buffer.alloc(16), blockSize: 65536 };
      const clearBottle = new Bottle(CAP_14, asyncify([ fromHex("68656c6c6f") ]));
      const bottle = await writeEncryptedBottle(Encryption.AES_128_GCM, clearBottle, options);

      // read it out using EncryptedBottle.read
      const b = await Bottle.read(byteReader(bottle.write()));
      b.cap.type.should.eql(BottleType.ENCRYPTED);
      b.cap.header.toString().should.eql("Header(U8(0)=0, U8(1)=16)");

      const b2 = await readEncryptedBottle(b, { getKey: async () => options.key });
      b2.cap.type.should.eql(14);
      b2.cap.header.toString().should.eql("Header()");
      (await drain(await b2.nextDataStream())).toString().should.eql("hello");

      await b2.done();
      await b.done();
    });

    it("with argon", async () => {
      const options = { argonKey: Buffer.from("cat"), argonSalt: Buffer.alloc(16) };
      const clearBottle = new Bottle(CAP_14, asyncify([ fromHex("68656c6c6f") ]));
      const bottle = await writeEncryptedBottle(Encryption.AES_128_GCM, clearBottle, options);

      // read it out using EncryptedBottle.read
      const b = await Bottle.read(byteReader(bottle.write()));
      b.cap.type.should.eql(BottleType.ENCRYPTED);
      b.cap.header.toString().should.eql(`Header(U8(0)=0, U8(1)=16, S(1)="3,4096,1,AAAAAAAAAAAAAAAAAAAAAA==")`);

      const b2 = await readEncryptedBottle(b, { getPassword: async () => options.argonKey });
      b2.cap.type.should.eql(14);
      b2.cap.header.toString().should.eql("Header()");
      (await drain(await b2.nextDataStream())).toString().should.eql("hello");

      await b2.done();
      await b.done();
    });

    it("with recipients", async ()  => {
      const encrypter = (recipient: string, key: Buffer): Promise<Buffer> => {
        return Promise.resolve(Buffer.from(recipient + ":" + key.toString("hex")));
      };
      const decrypterFor = (name: string) => {
        return async (keys: Map<string, Buffer>) => {
          const hexKey = keys.get(name)?.toString().split(":")[1];
          if (!hexKey) throw new Error("nope");
          return Buffer.from(hexKey, "hex");
        };
      };

      const options = {
        key: crypto.randomBytes(16),
        recipients: [ "garfield", "jon" ],
        encrypter
      };
      const clearBottle = new Bottle(CAP_14, asyncify([ fromHex("68656c6c6f") ]));
      const bottle = await writeEncryptedBottle(Encryption.AES_128_GCM, clearBottle, options);
      const bottleData = await drain(bottle.write());

      // read it out using EncryptedBottle.read
      let b = await Bottle.read(byteReader([ bottleData ]));
      b.cap.type.should.eql(BottleType.ENCRYPTED);
      b.cap.header.toString().should.eql(`Header(U8(0)=0, U8(1)=16, S(0)="garfield,jon")`);

      const b2 = await readEncryptedBottle(b, { decryptKey: decrypterFor("jon") });
      b2.cap.type.should.eql(14);
      b2.cap.header.toString().should.eql("Header()");
      (await drain(await b2.nextDataStream())).toString().should.eql("hello");

      await b2.done();
      await b.done();

      b = await Bottle.read(byteReader([ bottleData ]));
      b.cap.type.should.eql(BottleType.ENCRYPTED);
      b.cap.header.toString().should.eql(`Header(U8(0)=0, U8(1)=16, S(0)="garfield,jon")`);

      const b3 = await readEncryptedBottle(b, { decryptKey: decrypterFor("garfield") });
      b3.cap.type.should.eql(14);
      b3.cap.header.toString().should.eql("Header()");
      (await drain(await b3.nextDataStream())).toString().should.eql("hello");

      await b3.done();
      await b.done();
    });
  });
});
