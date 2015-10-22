"use strict";

import { bottleReader, TYPE_ENCRYPTED } from "../../lib/lib4bottle/bottle_stream";
import {
  decodeEncryptionHeader,
  encryptedBottleReader,
  encryptedBottleWriter,
  ENCRYPTION_AES_256_CTR
} from "../../lib/lib4bottle/encrypted_bottle";
import Promise from "bluebird";
import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { future } from "mocha-sprinkles";

import "should";
import "source-map-support/register";

const DATA1 = new Buffer("hello sailor!");

describe("encryptedBottleWriter", () => {
  describe("encrypts", () => {
    it("with one recipient", future(() => {
      let savedKey = null;
      const encrypter = (name, buffer) => {
        savedKey = buffer;
        return Promise.resolve(new Buffer("odie"));
      };
      const decrypter = keymap => {
        Array.from(keymap.keys()).should.eql([ "garfield" ]);
        keymap.get("garfield").toString().should.eql("odie");
        return Promise.resolve(savedKey);
      };

      return encryptedBottleWriter(
        ENCRYPTION_AES_256_CTR,
        { recipients: [ "garfield" ], encrypter }
      ).then(({ writer, bottle }) => {
        sourceStream(DATA1).pipe(writer);
        return pipeToBuffer(bottle).then(buffer => {
          // now decrypt
          const reader = bottleReader();
          sourceStream(buffer).pipe(reader);
          return reader.readPromise().then(data => {
            data.type.should.eql(TYPE_ENCRYPTED);
            const header = decodeEncryptionHeader(data.header);
            header.encryptionType.should.eql(ENCRYPTION_AES_256_CTR);
            header.recipients.should.eql([ "garfield" ]);
            (header.scrypt == null).should.eql(true);

            return encryptedBottleReader(header, reader, { decrypter });
          }).then(stream => {
            return pipeToBuffer(stream);
          }).then(buffer => {
            buffer.should.eql(DATA1);
          });
        });
      });
    }));

    it("with two recipients", future(() => {
      const encrypter = (name, buffer) => {
        const keyBuffer = new Buffer(8 + buffer.length);
        keyBuffer.fill(0x20);
        new Buffer(name).copy(keyBuffer, 0);
        buffer.copy(keyBuffer, 8);
        return Promise.resolve(keyBuffer);
      };
      const decrypter = keymap => {
        Array.from(keymap.keys()).sort().should.eql([ "garfield", "odie" ]);
        return keymap.get("garfield").slice(8);
      };

      return encryptedBottleWriter(
        ENCRYPTION_AES_256_CTR,
        { recipients: [ "garfield", "odie" ], encrypter }
      ).then(({ writer, bottle }) => {
        sourceStream(DATA1).pipe(writer);
        return pipeToBuffer(bottle).then(buffer => {
          // now decrypt
          const reader = bottleReader();
          sourceStream(buffer).pipe(reader);
          return reader.readPromise().then(data => {
            data.type.should.eql(TYPE_ENCRYPTED);
            const header = decodeEncryptionHeader(data.header);
            header.encryptionType.should.eql(ENCRYPTION_AES_256_CTR);
            header.recipients.should.eql([ "garfield", "odie" ]);
            (header.scrypt == null).should.eql(true);

            return encryptedBottleReader(header, reader, { decrypter });
          }).then(stream => {
            return pipeToBuffer(stream);
          }).then(buffer => {
            buffer.should.eql(DATA1);
          });
        });
      });
    }));

    it("with a key", future(() => {
      const keyBuffer = new Buffer(48);
      keyBuffer.fill(0);
      return encryptedBottleWriter(
        ENCRYPTION_AES_256_CTR,
        { key: keyBuffer }
      ).then(({ writer, bottle }) => {
        sourceStream(DATA1).pipe(writer);
        return pipeToBuffer(bottle).then(buffer => {
          // now decrypt
          const reader = bottleReader();
          sourceStream(buffer).pipe(reader);
          return reader.readPromise().then(data => {
            data.type.should.eql(TYPE_ENCRYPTED);
            const header = decodeEncryptionHeader(data.header);
            header.encryptionType.should.eql(ENCRYPTION_AES_256_CTR);
            (header.recipients == null).should.eql(true);
            (header.scrypt == null).should.eql(true);

            return encryptedBottleReader(header, reader, { key: keyBuffer });
          }).then(stream => {
            return pipeToBuffer(stream);
          }).then(buffer => {
            buffer.should.eql(DATA1);
          });
        });
      });
    }));

    it("using scrypt", future(() => {
      return encryptedBottleWriter(
        ENCRYPTION_AES_256_CTR,
        { password: "kwyjibo" }
      ).then(({ writer, bottle }) => {
        sourceStream(DATA1).pipe(writer);
        return pipeToBuffer(bottle).then(buffer => {
          // now decrypt
          const reader = bottleReader();
          sourceStream(buffer).pipe(reader);
          return reader.readPromise().then(data => {
            data.type.should.eql(TYPE_ENCRYPTED);
            const header = decodeEncryptionHeader(data.header);
            header.encryptionType.should.eql(ENCRYPTION_AES_256_CTR);
            (header.recipients == null).should.eql(true);
            header.scrypt.slice(0, 3).should.eql([ "14", "8", "1" ]);

            return encryptedBottleReader(header, reader, { getPassword: () => Promise.resolve("kwyjibo") });
          }).then(stream => {
            return pipeToBuffer(stream);
          }).then(buffer => {
            buffer.should.eql(DATA1);
          });
        });
      });
    }));
  });
});
