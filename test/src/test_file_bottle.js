"use strict";

import * as bottle_stream from "../../lib/lib4q/bottle_stream";
import * as file_bottle from "../../lib/lib4q/file_bottle";
import fs from "fs";
import toolkit from "stream-toolkit";
import { future, withTempFolder } from "mocha-sprinkles";

import "should";
import "source-map-support/register";

describe("FileBottleWriter", () => {
  it("writes and decodes from data", future(() => {
    const header = {
      filename: "bogus.txt",
      mode: 7,
      size: 10,
      createdNanos: 1234567890,
      username: "tyrion"
    };
    const bottle = new file_bottle.FileBottleWriter(header);
    toolkit.sourceStream("television").pipe(bottle);
    return toolkit.pipeToBuffer(bottle).then((data) => {
      // now decode it.
      return bottle_stream.readBottleFromStream(toolkit.sourceStream(data)).then((bottle) => {
        bottle.type.should.eql(bottle_stream.TYPE_FILE);
        bottle.header.filename.should.eql("bogus.txt");
        bottle.header.mode.should.eql(7);
        bottle.header.createdNanos.should.eql(1234567890);
        bottle.header.size.should.eql(10);
        bottle.header.username.should.eql("tyrion");
        return bottle.readPromise().then((fileStream) => {
          return toolkit.pipeToBuffer(fileStream).then((data) => {
            data.toString().should.eql("television");
          });
        });
      });
    });
  }));

  it("writes and decodes an actual file", future(withTempFolder((folder) => {
    const filename = `${folder}/test.txt`;
    fs.writeFileSync(filename, "hello!\n");
    const stats = fs.statSync(filename);
    const bottle = new file_bottle.FileBottleWriter(file_bottle.fileHeaderFromStats(filename, stats));
    fs.createReadStream(filename).pipe(bottle);
    return toolkit.pipeToBuffer(bottle).then((data) => {
      // now decode it.
      return bottle_stream.readBottleFromStream(toolkit.sourceStream(data)).then((bottle) => {
        bottle.type.should.eql(bottle_stream.TYPE_FILE);
        bottle.header.filename.should.eql(`${folder}/test.txt`);
        bottle.header.folder.should.eql(false);
        bottle.header.size.should.eql(7);
        return bottle.readPromise().then((fileStream) => {
          return toolkit.pipeToBuffer(fileStream).then((data) => {
            data.toString().should.eql("hello!\n");
          });
        });
      });
    });
  })));

  it("writes a nested folder correctly", future(() => {
    const bottle1 = new file_bottle.FolderBottleWriter({ filename: "outer", folder: true });
    const bottle2 = new file_bottle.FolderBottleWriter({ filename: "inner", folder: true });
    const bottle3 = new file_bottle.FileBottleWriter({ filename: "test.txt", size: 3 });
    toolkit.sourceStream("abc").pipe(bottle3);
    // wire it up!
    bottle1.write(bottle2);
    bottle1.end();
    bottle2.write(bottle3);
    bottle2.end();
    return toolkit.pipeToBuffer(bottle1).then((data) => {
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
