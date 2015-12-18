"use strict";

import { ArchiveReader, ArchiveWriter, ENCRYPTION_AES_256_CTR, encryptedBottleWriter, scanArchive } from "../../lib/lib4bottle";
import fs from "fs";
import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { future, withTempFolder } from "mocha-sprinkles";

import "should";
import "source-map-support/register";

function archiveWriter() {
  const w = new ArchiveWriter();
  w.collectedEvents = [];
  w.on("filename", (filename, stats) => w.collectedEvents.push({ event: "filename", filename, stats }));
  w.on("status", (filename, byteCount) => w.collectedEvents.push({ event: "status", filename, byteCount }));
  return w;
}

function archiveReader(options = {}) {
  options.processFile = ({ fileHeader, stream }) => {
    return pipeToBuffer(stream).then(data => {
      r.collectedEvents.push({ event: "data", header: fileHeader, data });
    });
  };

  const r = new ArchiveReader(options);
  r.collectedEvents = [];
  r.on("start-bottle", ({ type, header }) => r.collectedEvents.push({ event: "start-bottle", type, header }));
  r.on("end-bottle", ({ type, header }) => r.collectedEvents.push({ event: "end-bottle", type, header }));
  r.on("hash", (bottle, isValid, hex) => r.collectedEvents.push({ event: "hash-valid", bottle, isValid, hex }));
  r.on("encrypt", ({ type, header }) => r.collectedEvents.push({ event: "encrypt", type, header }));
  r.on("compress", bottle => r.collectedEvents.push({ event: "compress", bottle }));
  return r;
}


describe("ArchiveWriter", () => {
  it("processes a file", future(withTempFolder(folder => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");
    const w = archiveWriter();
    return w.archiveFile(`${folder}/test.txt`).then(bottle => {
      return pipeToBuffer(bottle).then(data => {
        data.length.should.eql(77);
        w.collectedEvents.filter(e => e.event == "filename").map(e => e.filename).should.eql([ "test.txt" ]);
      });
    });
  })));

  it("processes a folder", future(withTempFolder(folder => {
    fs.mkdirSync(`${folder}/stuff`);
    fs.writeFileSync(`${folder}/stuff/one.txt`, "one!");
    fs.writeFileSync(`${folder}/stuff/two.txt`, "two!");
    const w = archiveWriter();
    return w.archiveFile(`${folder}/stuff`).then(bottle => {
      return pipeToBuffer(bottle).then(() => {
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

    return encryptedBottleWriter(
      ENCRYPTION_AES_256_CTR,
      { password: "throwing muses" }
    ).then(({ writer, bottle }) => {
      const w = archiveWriter();
      return w.archiveFile(`${folder}/hello.txt`).then(archiveBottle => {
        archiveBottle.pipe(writer);
        return pipeToBuffer(bottle);
      });
    }).then(data => {
      const r = archiveReader({
        getPassword: () => Promise.resolve("throwing muses")
      });
      return r.scanStream(sourceStream(data)).then(() => {
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


describe("scanArchive", () => {
  function scan(stream) {
    return new Promise((resolve, reject) => {
      const collectedEvents = [];

      scanArchive(stream).subscribe(
        event => {
          switch (event.event) {
            case "file":
              pipeToBuffer(event.stream).then(data => {
                event.data = data;
                event.stream = null;
                collectedEvents.push(event);
                console.log(event);
              });
              break;
            default:
              console.log(event);
              collectedEvents.push(event);
          }
        },
        error => reject(error),
        () => resolve(collectedEvents)
      );
    });
  }

  it("reads a file", future(() => {
    const data = [
      "f09f8dbc0000003d0008746573742e7478748402a401880800ae4ae2d77e9213",
      "8c0800ae4ae2d77e9213900800ae4ae2d77e92138001050805726f6265790c05",
      "776865656c0568656c6c6f00ff"
    ].join("");

    return scan(sourceStream(new Buffer(data, "hex"))).then(events => {
      events.map(e => e.event).should.eql([ "start", "file", "end" ]);
      events[1].header.filename.should.eql("test.txt");
      events[1].data.toString().should.eql("hello");
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

    return scan(sourceStream(new Buffer(data, "hex"))).then(events => {
      events.map(e => e.event).should.eql([
        "start",
        "enter-folder",
        "start",
        "file",
        "end",
        "start",
        "file",
        "end",
        "exit-folder",
        "end"
      ]);
      events[1].header.filename.should.eql("stuff");
      events[3].header.filename.should.eql("one.txt");
      events[3].data.toString().should.eql("one!");
      events[6].header.filename.should.eql("two.txt");
      events[6].data.toString().should.eql("two!");
      events[8].header.filename.should.eql("stuff");
    });
  }));
});

describe("ArchiveReader", () => {
  it("reads a file", future(() => {
    const data = [
      "f09f8dbc0000003d0008746573742e7478748402a401880800ae4ae2d77e9213",
      "8c0800ae4ae2d77e9213900800ae4ae2d77e92138001050805726f6265790c05",
      "776865656c0568656c6c6f00ff"
    ].join("");
    const r = archiveReader();
    return r.scanStream(sourceStream(new Buffer(data, "hex"))).then(() => {
      r.collectedEvents.map(e => e.event).should.eql([ "start-bottle", "data", "end-bottle" ]);
      r.collectedEvents[1].header.filename.should.eql("test.txt");
      r.collectedEvents[1].data.toString().should.eql("hello");
    });
  }));



//   it("reads a compressed, hashed file", future(() => {
//     const r = archiveReader();
//     return r.scanStream(fs.createReadStream("./test/fixtures/a.4b")).then(() => {
//       r.collectedEvents.map(e => e.event).should.eql([
//         "start-bottle",
//         "start-bottle",
//         "compress",
//         "start-bottle",
//         "data",
//         "end-bottle",
//         "end-bottle",
//         "hash-valid",
//         "end-bottle"
//       ]);
//
//       r.collectedEvents[0].bottle.typeName().should.eql("hashed/SHA-512");
//       r.collectedEvents[1].bottle.typeName().should.eql("compressed/LZMA2");
//       r.collectedEvents[3].bottle.typeName().should.eql("file");
//       r.collectedEvents[3].bottle.header.filename.should.eql("qls.js");
//       r.collectedEvents[5].bottle.typeName().should.eql("file");
//       r.collectedEvents[5].bottle.header.filename.should.eql("qls.js");
//       r.collectedEvents[6].bottle.typeName().should.eql("compressed/LZMA2");
//       r.collectedEvents[7].isValid.should.eql(true);
//       r.collectedEvents[7].hex.slice(0, 16).should.eql("aa32eaf0c2b5b95b");
//       r.collectedEvents[8].bottle.typeName().should.eql("hashed/SHA-512");
//     });
//   }));
});
