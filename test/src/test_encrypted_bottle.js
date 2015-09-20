"use strict";

import * as bottle_stream from "../../lib/lib4bottle/bottle_stream";
import * as encrypted_bottle from "../../lib/lib4bottle/encrypted_bottle";
import Promise from "bluebird";
import toolkit from "stream-toolkit";
import { future } from "mocha-sprinkles";

import "should";
import "source-map-support/register";

const DATA1 = new Buffer("hello sailor!");

describe("EncryptedBottleWriter", () => {
  describe("encrypts", () => {
    it("with one recipient", future(() => {
      let savedKey = null;
      const encrypter = (name, buffer) => {
        savedKey = buffer;
        return Promise.resolve(new Buffer("odie"));
      };
      const es = new encrypted_bottle.EncryptedBottleWriter(
        encrypted_bottle.ENCRYPTION_AES_256_CTR,
        { recipients: [ "garfield" ], encrypter }
      );
      toolkit.sourceStream(DATA1).pipe(es);
      return toolkit.pipeToBuffer(es).then(buffer => {
        // now decrypt
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then(encryptedBottle => {
        encryptedBottle.type.should.eql(bottle_stream.TYPE_ENCRYPTED);
        encryptedBottle.header.encryptionType.should.eql(encrypted_bottle.ENCRYPTION_AES_256_CTR);
        encryptedBottle.header.recipients.should.eql([ "garfield" ]);
        (encryptedBottle.header.scrypt == null).should.eql(true);
        return encryptedBottle.readKeys().then(({ keymap }) => {
          Object.keys(keymap).should.eql([ "garfield" ]);
          keymap.garfield.toString().should.eql("odie");
          return encryptedBottle.decrypt(savedKey);
        }).then(stream => {
          return toolkit.pipeToBuffer(stream);
        }).then(buffer => {
          buffer.should.eql(DATA1);
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
      const es = new encrypted_bottle.EncryptedBottleWriter(
        encrypted_bottle.ENCRYPTION_AES_256_CTR,
        { recipients: [ "garfield", "odie" ], encrypter }
      );
      toolkit.sourceStream(DATA1).pipe(es);
      return toolkit.pipeToBuffer(es).then(buffer => {
        // now decrypt
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then(encryptedBottle => {
        encryptedBottle.type.should.eql(bottle_stream.TYPE_ENCRYPTED);
        encryptedBottle.header.encryptionType.should.eql(encrypted_bottle.ENCRYPTION_AES_256_CTR);
        encryptedBottle.header.recipients.should.eql([ "garfield", "odie" ]);
        (encryptedBottle.header.scrypt == null).should.eql(true);
        return encryptedBottle.readKeys().then(({ keymap }) => {
          Object.keys(keymap).should.eql([ "garfield", "odie" ]);
          const key = keymap.garfield.slice(8);
          return encryptedBottle.decrypt(key);
        }).then(stream => {
          return toolkit.pipeToBuffer(stream);
        }).then(buffer => {
          buffer.should.eql(DATA1);
        });
      });
    }));

    it("with a key", future(() => {
      const keyBuffer = new Buffer(48);
      keyBuffer.fill(0);
      const es = new encrypted_bottle.EncryptedBottleWriter(
        encrypted_bottle.ENCRYPTION_AES_256_CTR,
        { key: keyBuffer }
      );
      toolkit.sourceStream(DATA1).pipe(es);
      return toolkit.pipeToBuffer(es).then(buffer => {
        // now decrypt
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then(encryptedBottle => {
        encryptedBottle.type.should.eql(bottle_stream.TYPE_ENCRYPTED);
        encryptedBottle.header.encryptionType.should.eql(encrypted_bottle.ENCRYPTION_AES_256_CTR);
        (encryptedBottle.header.recipients == null).should.eql(true);
        (encryptedBottle.header.scrypt == null).should.eql(true);
        return encryptedBottle.readKeys().then(({ keymap }) => {
          Object.keys(keymap).should.eql([]);
          return encryptedBottle.decrypt(keyBuffer);
        }).then(stream => {
          return toolkit.pipeToBuffer(stream);
        }).then(buffer => {
          buffer.should.eql(DATA1);
        });
      });
    }));

    it("using scrypt", future(() => {
      const es = new encrypted_bottle.EncryptedBottleWriter(
        encrypted_bottle.ENCRYPTION_AES_256_CTR,
        { password: "kwyjibo" }
      );
      toolkit.sourceStream(DATA1).pipe(es);
      return toolkit.pipeToBuffer(es).then(buffer => {
        // now decrypt
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then(encryptedBottle => {
        encryptedBottle.type.should.eql(bottle_stream.TYPE_ENCRYPTED);
        encryptedBottle.header.encryptionType.should.eql(encrypted_bottle.ENCRYPTION_AES_256_CTR);
        (encryptedBottle.header.recipients == null).should.eql(true);
        encryptedBottle.header.scrypt.slice(0, 3).should.eql([ "14", "8", "1" ]);
        return encryptedBottle.readKeys().then(({ keymap, scrypt }) => {
          Object.keys(keymap).should.eql([]);
          return encryptedBottle.generateKey("kwyjibo", scrypt).then(key => {
            return encryptedBottle.decrypt(key);
          });
        }).then(stream => {
          return toolkit.pipeToBuffer(stream);
        }).then(buffer => {
          buffer.should.eql(DATA1);
        });
      });
    }));
  });
});
