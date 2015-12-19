"use strict";

import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { readBottle, TYPE_FILE } from "../../lib/lib4bottle/bottle_stream";
import { decodeFileHeader, writeFileBottle } from "../../lib/lib4bottle/file_bottle";

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
export function writeFile(filename) {
  const data = KNOWN_FILES[filename].data;
  const bottleWriter = writeFileBottle({ filename: filename, size: data.length });
  bottleWriter.write(sourceStream(data));
  bottleWriter.end();
  return pipeToBuffer(bottleWriter).then(fileBuffer => {
    // quick verification that it encoded correctly.
    fileBuffer.toString("hex").should.eql(KNOWN_FILES[filename].bottleData);
    return fileBuffer;
  });
}

// read a file bottle out of another bottle.
export function readFile(stream, filename) {
  const bottle = readBottle();
  stream.pipe(bottle);
  return bottle.readPromise().then(data => {
    data.type.should.eql(TYPE_FILE);
    const header = decodeFileHeader(data.header);
    header.filename.should.eql(filename);

    return bottle.readPromise().then(dataStream => {
      return pipeToBuffer(dataStream);
    }).then(data => {
      data.toString("hex").should.eql(KNOWN_FILES[filename].data.toString("hex"));
      return { header, data };
    });
  });
}
