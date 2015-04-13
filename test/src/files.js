"use strict";

const bottle_stream = require("../../lib/lib4q/bottle_stream");
const file_bottle = require("../../lib/lib4q/file_bottle");
const toolkit = require("stream-toolkit");
const util = require("util");

const KNOWN_FILES = {
  "file.txt": {
    data: new Buffer("the new pornographers"),
    bottleData: [
      "f09f8dbc0000000d000866696c652e74787480011515746865206e657720706f",
      "726e6f677261706865727300ff"
    ].join("")
  }
};

// write a file bottle into a buffer.
function writeFile(filename) {
  const data = KNOWN_FILES[filename].data;
  const bottleWriter = new file_bottle.FileBottleWriter({ filename: filename, size: data.length });
  toolkit.sourceStream(data).pipe(bottleWriter);
  return toolkit.pipeToBuffer(bottleWriter).then((fileBuffer) => {
    // quick verification that it encoded correctly.
    fileBuffer.toString("hex").should.eql(KNOWN_FILES[filename].bottleData);
    return fileBuffer;
  });
}

// given a decoded file bottle, validate that it contains the right data.
function validateFile(fileBottle, filename) {
  const data = KNOWN_FILES[filename].data;
  fileBottle.type.should.eql(bottle_stream.TYPE_FILE);
  fileBottle.header.filename.should.eql(filename);
  return fileBottle.readPromise().then((dataStream) => {
    return toolkit.pipeToBuffer(dataStream).then((buffer) => {
      buffer.toString().should.eql(data.toString());
      // new in io.js: need to exhaustively read to the end of the stream,
      // or we won't get the "end" event.
      return fileBottle.readPromise().then((nextStream) => {
        (nextStream == null).should.eql(true);
        return fileBottle.endPromise();
      }).then(() => {
        return { header: fileBottle.header, data: buffer };
      });
    });
  });
}

// read a file bottle out of another bottle.
function readFile(bottle, filename) {
  return bottle.readPromise().then((fileStream) => {
    return bottle_stream.readBottleFromStream(fileStream).then((fileBottle) => {
      return validateFile(fileBottle, filename);
    }).then((rv) => {
      // new in io.js: exhaust the stream, as above.
      return fileStream.readPromise(1).then((empty) => {
        (empty == null).should.eql(true);
        return fileStream.endPromise().then(() => rv);
      });
    });
  });
}


exports.readFile = readFile;
exports.validateFile = validateFile;
exports.writeFile = writeFile;
