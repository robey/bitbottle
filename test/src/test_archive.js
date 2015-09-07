"use strict";

import * as lib4bottle from "../../lib/lib4bottle";
import fs from "fs";
import toolkit from "stream-toolkit";
import { future, withTempFolder } from "mocha-sprinkles";

import "should";
import "source-map-support/register";

function archiveWriter() {
  const w = new lib4bottle.ArchiveWriter();
  w.collectedEvents = [];
  w.on("filename", (filename, stats) => w.collectedEvents.push({ event: "filename", filename, stats }));
  w.on("status", (filename, byteCount) => w.collectedEvents.push({ event: "status", filename, byteCount }));
  return w;
}

function archiveReader(options = {}) {
  options.processFile = (dataStream) => {
    return toolkit.pipeToBuffer(dataStream).then((data) => {
      r.collectedEvents.push({ event: "data", data });
    });
  };

  const r = new lib4bottle.ArchiveReader(options);
  r.collectedEvents = [];
  r.on("start-bottle", (bottle) => r.collectedEvents.push({ event: "start-bottle", bottle }));
  r.on("end-bottle", (bottle) => r.collectedEvents.push({ event: "end-bottle", bottle }));
  r.on("hash", (bottle, isValid, hex) => r.collectedEvents.push({ event: "hash-valid", bottle, isValid, hex }));
  r.on("encrypt", bottle => r.collectedEvents.push({ event: "encrypt", bottle }));
  r.on("compress", bottle => r.collectedEvents.push({ event: "compress", bottle }));
  return r;
}


describe("ArchiveWriter", () => {
  it("processes a file", future(withTempFolder((folder) => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");
    const w = archiveWriter();
    return w.archiveFile(`${folder}/test.txt`).then((bottle) => {
      return toolkit.pipeToBuffer(bottle).then((data) => {
        data.length.should.eql(77);
        w.collectedEvents.filter((e) => e.event == "filename").map((e) => e.filename).should.eql([ "test.txt" ]);
      });
    });
  })));

  it("processes a folder", future(withTempFolder(folder => {
    fs.mkdirSync(`${folder}/stuff`);
    fs.writeFileSync(`${folder}/stuff/one.txt`, "one!");
    fs.writeFileSync(`${folder}/stuff/two.txt`, "two!");
    const w = archiveWriter();
    return w.archiveFile(`${folder}/stuff`).then(bottle => {
      return toolkit.pipeToBuffer(bottle).then(data => {
        w.collectedEvents.filter(e => e.event == "filename").map(e => e.filename).should.eql([
          "stuff/",
          "stuff/one.txt",
          "stuff/two.txt"
        ]);
      });
    });
  })));

  it("creates and reads an encrypted archive", future(withTempFolder(folder => {
    fs.writeFileSync(`${folder}/hello.txt`, "hello, i must be going!");

    return lib4bottle.writeEncryptedBottle(
      lib4bottle.ENCRYPTION_AES_256_CTR,
      { password: "throwing muses" }
    ).then(bottle => {
      const w = archiveWriter();
      return w.archiveFile(`${folder}/hello.txt`).then(archiveBottle => {
        archiveBottle.pipe(bottle);
        return toolkit.pipeToBuffer(bottle);
      });
    }).then(data => {
      const r = archiveReader({
        getPassword: () => Promise.resolve("throwing muses"),
      });
      return r.scanStream(toolkit.sourceStream(data)).then(() => {
        r.collectedEvents.map(e => e.event).should.eql([
          "start-bottle",
          "encrypt",
          "start-bottle",
          "data",
          "end-bottle",
          "end-bottle"
        ]);
        r.collectedEvents[3].data.toString().should.eql("hello, i must be going!");
      });
    });
  })));
});

describe("ArchiveReader", () => {
  it("reads a file", future(() => {
    const data = [
      "f09f8dbc0000003d0008746573742e7478748402a401880800ae4ae2d77e9213",
      "8c0800ae4ae2d77e9213900800ae4ae2d77e92138001050805726f6265790c05",
      "776865656c0568656c6c6f00ff"
    ].join("");
    const r = archiveReader();
    return r.scanStream(toolkit.sourceStream(new Buffer(data, "hex"))).then(() => {
      r.collectedEvents.map(e => e.event).should.eql([ "start-bottle", "data", "end-bottle" ]);
      r.collectedEvents[0].bottle.header.filename.should.eql("test.txt");
      r.collectedEvents[1].data.toString().should.eql("hello");
    });
  }));

  it("reads a folder", future(() => {
    const data = [
      "f09f8dbc00000039000573747566668402ed0188080040b675ecffa2138c0800",
      "40b675ecffa21390080040b675ecffa213c0000805726f6265790c0577686565",
      "6c4bf09f8dbc0000003c00076f6e652e7478748402a40188080040b675ecffa2",
      "138c080040b675ecffa21390080040b675ecffa2138001040805726f6265790c",
      "05776865656c046f6e652100ff004bf09f8dbc0000003c000774776f2e747874",
      "8402a40188080040b675ecffa2138c080040b675ecffa21390080040b675ecff",
      "a2138001040805726f6265790c05776865656c0474776f2100ff00ff"
    ].join("");
    const r = archiveReader();
    return r.scanStream(toolkit.sourceStream(new Buffer(data, "hex"))).then(() => {
      r.collectedEvents.map(e => e.event).should.eql([
        "start-bottle",
        "start-bottle",
        "data",
        "end-bottle",
        "start-bottle",
        "data",
        "end-bottle",
        "end-bottle"
      ]);
      r.collectedEvents[0].bottle.header.filename.should.eql("stuff");
      r.collectedEvents[1].bottle.header.filename.should.eql("one.txt");
      r.collectedEvents[2].data.toString().should.eql("one!");
      r.collectedEvents[4].bottle.header.filename.should.eql("two.txt");
      r.collectedEvents[5].data.toString().should.eql("two!");
    });
  }));

  it("reads a compressed, hashed file", future(() => {
    const r = archiveReader();
    return r.scanStream(fs.createReadStream("./test/fixtures/a.4b")).then(() => {
      r.collectedEvents.map(e => e.event).should.eql([
        "start-bottle",
        "start-bottle",
        "compress",
        "start-bottle",
        "data",
        "end-bottle",
        "end-bottle",
        "hash-valid",
        "end-bottle"
      ]);

      r.collectedEvents[0].bottle.typeName().should.eql("hashed/SHA-512");
      r.collectedEvents[1].bottle.typeName().should.eql("compressed/LZMA2");
      r.collectedEvents[3].bottle.typeName().should.eql("file");
      r.collectedEvents[3].bottle.header.filename.should.eql("qls.js");
      r.collectedEvents[5].bottle.typeName().should.eql("file");
      r.collectedEvents[5].bottle.header.filename.should.eql("qls.js");
      r.collectedEvents[6].bottle.typeName().should.eql("compressed/LZMA2");
      r.collectedEvents[7].isValid.should.eql(true);
      r.collectedEvents[7].hex.slice(0, 16).should.eql("aa32eaf0c2b5b95b");
      r.collectedEvents[8].bottle.typeName().should.eql("hashed/SHA-512");
    });
  }));
});
