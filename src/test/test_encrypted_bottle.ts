import * as argon2 from "argon2";
import { Decorate } from "ballvalve";
import * as crypto from "crypto";
import { BottleType, Bottle } from "../bottle";
import { EncryptedBottle, Encryption, EncryptionOptions } from "../encrypted_bottle";
import { Readable } from "../readable";
import { drain, hex, readBottle } from "./tools";

import "should";
import "source-map-support/register";

function writeBottle(type: Encryption, data: Buffer, options: EncryptionOptions, needMore: [boolean]): Promise<Buffer> {
  return drain(EncryptedBottle.write(type, Decorate.iterator([ data ]), options, needMore));
}

const TestString = "spoon!";

describe("EncryptedBottle", () => {
  describe("encrypts", () => {
    it("with key", async () => {
      const options = { key: Buffer.alloc(16), argonSalt: Buffer.alloc(16) };
      const needMore: [boolean] = [ false ];
      const buffer = await writeBottle(Encryption.AES_128_GCM, Buffer.from(TestString), options, needMore);
      needMore[0].should.eql(false);

      const b = await readBottle(buffer);
      b.cap.type.should.eql(BottleType.Encrypted);
      b.cap.header.toString().should.eql("Header(I0=0, S1=3,4096,1,AAAAAAAAAAAAAAAAAAAAAA==)");

      // encrypt the same data manually
      const argonOptions = { raw: true, salt: Buffer.alloc(16) } as argon2.Options & { raw: true };
      const keyData = await argon2.hash(Buffer.alloc(16), argonOptions);
      const cipher = crypto.createCipheriv("aes-128-gcm", keyData.slice(0, 16), keyData.slice(16));
      const encrypted = Buffer.concat([ cipher.update(Buffer.from(TestString)), cipher.final() ]);
      const authTag = cipher.getAuthTag();

      (await drain(await b.nextStream())).should.eql(encrypted);
      (await drain(await b.nextStream())).should.eql(authTag);
      await b.assertEndOfStreams();
    });
  });
});
