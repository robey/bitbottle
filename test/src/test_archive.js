"use strict";

import * as archive from "../../lib/lib4q/archive";
import fs from "fs";
import toolkit from "stream-toolkit";
import { future, withTempFolder } from "mocha-sprinkles";

import "should";
import "source-map-support/register";

function archiveWriter() {
  const w = new archive.ArchiveWriter();
  w.collectedEvents = [];
  w.on("filename", (filename, stats) => w.collectedEvents.push({ event: "filename", filename, stats }));
  w.on("status", (filename, byteCount) => w.collectedEvents.push({ event: "status", filename, byteCount }));
  return w;
}

function archiveReader() {
  const r = new archive.ArchiveReader();
  r.collectedEvents = [];
  r.on("start-bottle", (bottle) => r.collectedEvents.push({ event: "start-bottle", bottle }));
  r.on("end-bottle", (bottle) => r.collectedEvents.push({ event: "end-bottle", bottle }));
  r.on("hash", (bottle, isValid, hex) => r.collectedEvents.push({ event: "hash-valid", bottle, isValid, hex }));
  r.processFile = (dataStream) => {
    return toolkit.pipeToBuffer(dataStream).then((data) => {
      r.collectedEvents.push({ event: "data", data });
    });
  };
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

  it("processes a folder", future(withTempFolder((folder) => {
    fs.mkdirSync(`${folder}/stuff`);
    fs.writeFileSync(`${folder}/stuff/one.txt`, "one!");
    fs.writeFileSync(`${folder}/stuff/two.txt`, "two!");
    const w = archiveWriter();
    return w.archiveFile(`${folder}/stuff`).then((bottle) => {
      return toolkit.pipeToBuffer(bottle).then((data) => {
        w.collectedEvents.filter((e) => e.event == "filename").map((e) => e.filename).should.eql([
          "stuff/",
          "stuff/one.txt",
          "stuff/two.txt"
        ]);
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
      r.collectedEvents.map((e) => e.event).should.eql([ "start-bottle", "data", "end-bottle" ]);
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
      r.collectedEvents.map((e) => e.event).should.eql([
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
});
