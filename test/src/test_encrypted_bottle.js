"use strict";

import * as bottle_stream from "../../lib/lib4q/bottle_stream";
import * as encrypted_bottle from "../../lib/lib4q/encrypted_bottle";
import * as file_bottle from "../../lib/lib4q/file_bottle";
import Promise from "bluebird";
import toolkit from "stream-toolkit";
import { future } from "mocha-sprinkles";

import "should";
import "source-map-support/register";

const DATA1 = new Buffer("hello sailor!");

describe("EncryptedBottleWriter", () => {
  describe("encrypts", () => {
    it("with no recipients", future(() => {
      const es = new encrypted_bottle.EncryptedBottleWriter(encrypted_bottle.ENCRYPTION_AES_256_CTR);
      toolkit.sourceStream(DATA1).pipe(es);
      return toolkit.pipeToBuffer(es).then((buffer) => {
        // now decrypt
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then((encryptedBottle) => {
        encryptedBottle.type.should.eql(bottle_stream.TYPE_ENCRYPTED);
        encryptedBottle.header.encryptionType.should.eql(encrypted_bottle.ENCRYPTION_AES_256_CTR);
        encryptedBottle.header.recipients.should.eql([]);
        return encryptedBottle.readKeys().then((keys) => {
          keys.should.eql({});
          return encryptedBottle.decrypt(es.encryptionKey);
        }).then((stream) => {
          return toolkit.pipeToBuffer(stream);
        }).then((buffer) => {
          buffer.should.eql(DATA1);
        });
      });
    }));

    it("with one recipient", future(() => {
      let savedKey = null;
      const encrypter = (name, buffer) => {
        savedKey = buffer;
        return Promise.resolve(new Buffer("odie"));
      };
      const es = new encrypted_bottle.EncryptedBottleWriter(
        encrypted_bottle.ENCRYPTION_AES_256_CTR,
        [ "garfield" ],
        encrypter
      );
      toolkit.sourceStream(DATA1).pipe(es);
      return toolkit.pipeToBuffer(es).then((buffer) => {
        // now decrypt
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then((encryptedBottle) => {
        encryptedBottle.type.should.eql(bottle_stream.TYPE_ENCRYPTED);
        encryptedBottle.header.encryptionType.should.eql(encrypted_bottle.ENCRYPTION_AES_256_CTR);
        encryptedBottle.header.recipients.should.eql([ "garfield" ]);
        return encryptedBottle.readKeys().then((keys) => {
          Object.keys(keys).should.eql([ "garfield" ]);
          keys.garfield.toString().should.eql("odie");
          return encryptedBottle.decrypt(savedKey);
        }).then((stream) => {
          return toolkit.pipeToBuffer(stream);
        }).then((buffer) => {
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
        [ "garfield", "odie" ],
        encrypter
      );
      toolkit.sourceStream(DATA1).pipe(es);
      return toolkit.pipeToBuffer(es).then((buffer) => {
        // now decrypt
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then((encryptedBottle) => {
        encryptedBottle.type.should.eql(bottle_stream.TYPE_ENCRYPTED);
        encryptedBottle.header.encryptionType.should.eql(encrypted_bottle.ENCRYPTION_AES_256_CTR);
        encryptedBottle.header.recipients.should.eql([ "garfield", "odie" ]);
        return encryptedBottle.readKeys().then((keys) => {
          Object.keys(keys).should.eql([ "garfield", "odie" ]);
          const key = keys.garfield.slice(8);
          return encryptedBottle.decrypt(key);
        }).then((stream) => {
          return toolkit.pipeToBuffer(stream);
        }).then((buffer) => {
          buffer.should.eql(DATA1);
        });
      });
    }));

    it("with a key", future(() => {
      const keyBuffer = new Buffer(48);
      keyBuffer.fill(0);
      const es = new encrypted_bottle.EncryptedBottleWriter(
        encrypted_bottle.ENCRYPTION_AES_256_CTR,
        [ ],
        keyBuffer
      );
      toolkit.sourceStream(DATA1).pipe(es);
      return toolkit.pipeToBuffer(es).then((buffer) => {
        // now decrypt
        return bottle_stream.readBottleFromStream(toolkit.sourceStream(buffer));
      }).then((encryptedBottle) => {
        encryptedBottle.type.should.eql(bottle_stream.TYPE_ENCRYPTED);
        encryptedBottle.header.encryptionType.should.eql(encrypted_bottle.ENCRYPTION_AES_256_CTR);
        encryptedBottle.header.recipients.should.eql([]);
        return encryptedBottle.readKeys().then((keys) => {
          Object.keys(keys).should.eql([]);
          return encryptedBottle.decrypt(keyBuffer);
        }).then((stream) => {
          return toolkit.pipeToBuffer(stream);
        }).then((buffer) => {
          buffer.should.eql(DATA1);
        });
      });
    }));
  });
});
