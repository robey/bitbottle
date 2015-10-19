"use strict";

import fs from "fs";
import { bottleReader, TYPE_FILE } from "../../lib/lib4bottle/bottle_stream";
import { decodeFileHeader, fileBottleWriter, folderBottleWriter } from "../../lib/lib4bottle/file_bottle";
import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { future, withTempFolder } from "mocha-sprinkles";

import "should";
import "source-map-support/register";

describe("fileBottleWriter", () => {
  it("writes and decodes from data", future(() => {
    const stats = {
      filename: "bogus.txt",
      mode: 7,
      size: 10,
      createdNanos: 1234567890,
      username: "tyrion"
    };
    const bottle = fileBottleWriter(stats);
    bottle.write(sourceStream("television"));
    bottle.end();
    return pipeToBuffer(bottle).then(data => {
      // now decode it.
      const reader = bottleReader();
      sourceStream(data).pipe(reader);
      return reader.readPromise().then(data => {
        data.type.should.eql(TYPE_FILE);
        const header = decodeFileHeader(data.header);

        header.filename.should.eql("bogus.txt");
        header.mode.should.eql(7);
        header.createdNanos.should.eql(1234567890);
        header.size.should.eql(10);
        header.username.should.eql("tyrion");
        return reader.readPromise().then(fileStream => {
          return pipeToBuffer(fileStream).then(data => {
            data.toString().should.eql("television");
          });
        });
      });
    });
  }));

  it("writes and decodes an actual file", future(withTempFolder(folder => {
    const filename = `${folder}/test.txt`;
    fs.writeFileSync(filename, "hello!\n");
    const stats = fs.statSync(filename);
    stats.filename = filename;
    const bottle = fileBottleWriter(stats);
    bottle.write(fs.createReadStream(filename));
    bottle.end();
    return pipeToBuffer(bottle).then(data => {
      // now decode it.
      const reader = bottleReader();
      sourceStream(data).pipe(reader);
      return reader.readPromise().then(data => {
        data.type.should.eql(TYPE_FILE);
        const header = decodeFileHeader(data.header);

        header.filename.should.eql(`${folder}/test.txt`);
        header.folder.should.eql(false);
        header.size.should.eql(7);
        return reader.readPromise().then(fileStream => {
          return pipeToBuffer(fileStream).then(data => {
            data.toString().should.eql("hello!\n");
          });
        });
      });
    });
  })));

  it("writes a nested folder correctly", future(() => {
    const bottle1 = folderBottleWriter({ filename: "outer" });
    const bottle2 = folderBottleWriter({ filename: "inner" });
    const bottle3 = fileBottleWriter({ filename: "test.txt", size: 3 });
    bottle3.write(sourceStream("abc"));
    bottle3.end();
    // wire it up!
    bottle1.write(bottle2);
    bottle1.end();
    bottle2.write(bottle3);
    bottle2.end();
    return pipeToBuffer(bottle1).then(data => {
      data.toString("hex").should.eql(
        "f09f8dbc0000000900056f75746572c0002ff09f8dbc000000090005696e6e6572c0001bf09f8dbc0000000d0008746573742e7478748001030361626300ff00ff00ff"
      );
      // f09f8dbc 00000009
      //   0005 6f75746572  // "outer"
      //   c000             // folder
      //   2f
      //     f09f8dbc 00000009
      //     0005 696e6e6572  // "inner"
      //     c000             // folder
      //     1b
      //       f09f8dbc 0000000d
      //       0008 746573742e747874  // "test.txt"
      //       800103                 // size=3
      //       03
      //         616263
      //       00 ff
      //     00 ff
      //   00 ff
    });
  }));
});
