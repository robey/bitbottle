"use strict";

import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { bottleReader, TYPE_FILE } from "../../lib/lib4bottle/bottle_stream";
import { decodeFileHeader, fileBottleWriter } from "../../lib/lib4bottle/file_bottle";

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
  const bottleWriter = fileBottleWriter({ filename: filename, size: data.length });
  bottleWriter.write(sourceStream(data));
  bottleWriter.end();
  return pipeToBuffer(bottleWriter).then(fileBuffer => {
    // quick verification that it encoded correctly.
    fileBuffer.toString("hex").should.eql(KNOWN_FILES[filename].bottleData);
    return fileBuffer;
  });
}

// // given a decoded file bottle, validate that it contains the right data.
// export function validateFile(fileBottle, filename) {
//   const data = KNOWN_FILES[filename].data;
//   fileBottle.type.should.eql(TYPE_FILE);
//   fileBottle.header.filename.should.eql(filename);
//   return fileBottle.readPromise().then((dataStream) => {
//     return toolkit.pipeToBuffer(dataStream).then((buffer) => {
//       buffer.toString().should.eql(data.toString());
//         return { header: fileBottle.header, data: buffer };
//       });
//     });
//   });
// }

// read a file bottle out of another bottle.
export function readFile(stream, filename) {
  const bottle = bottleReader();
  stream.pipe(bottle);
  return bottle.readPromise().then(data => {
    data.type.should.eql(TYPE_FILE);
    const header = decodeFileHeader(data.header);
    header.filename.should.eql(filename);

    return bottle.readPromise().then(dataStream => {
      return pipeToBuffer(dataStream);
    }).then(data => {
      data.toString("hex").should.eql(KNOWN_FILES[filename].data.toString("hex"));
      //       // new in io.js: need to exhaustively read to the end of the stream,
      //       // or we won't get the "end" event.
      //       return fileBottle.readPromise().then((nextStream) => {
      //         (nextStream == null).should.eql(true);
      //         return fileBottle.endPromise();
      //       }).then(() => {
      return { header, data };
    });
  });
}
