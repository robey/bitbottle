import * as fs from "fs";
import * as path from "path";
import { Decorate, StreamAsyncIterator } from "ballvalve";
import { Bottle, BottleType } from "../bottle";
import { buffered } from "../buffered";
import { FileBottle, FileMetadata, statsToMetadata } from "../file_bottle";
import { Readable } from "../readable";
import { drain, hex, makeTempFolder, readBottle } from "./tools";

import "should";
import "source-map-support/register";

describe("FileBottle.write", () => {
  it("writes and decodes from data", async () => {
    const meta: FileMetadata = {
      filename: "bogus.txt",
      folder: false,
      posixMode: 7,
      size: 10,
      createdNanos: 1234567890,
      username: "tyrion"
    };
    const bottleStream = FileBottle.write(meta, Decorate.iterator([ Buffer.from("television") ]));

    const bottle = await Bottle.read(new Readable(bottleStream));
    bottle.cap.type.should.eql(BottleType.File);
    const file = await FileBottle.read(bottle);

    file.meta.filename.should.eql("bogus.txt");
    file.meta.folder.should.eql(false);
    (file.meta.posixMode || 0).should.eql(7);
    (file.meta.createdNanos || 0).should.eql(1234567890);
    (file.meta.size || 0).should.eql(10);
    (file.meta.username || "?").should.eql("tyrion");

    (await drain(file.stream)).toString().should.eql("television");
  });

  it("writes and decodes an actual file", async () => {
    const filename = path.join(makeTempFolder(), "test.txt");
    fs.writeFileSync(filename, "hello!\n");
    const stats = fs.statSync(filename);
    const stream = new StreamAsyncIterator(fs.createReadStream(filename));
    const bottleStream = FileBottle.write(statsToMetadata(filename, stats), stream);

    const bottle = await Bottle.read(new Readable(bottleStream));
    bottle.cap.type.should.eql(BottleType.File);
    const file = await FileBottle.read(bottle);
    file.meta.filename.should.eql(filename);
    file.meta.folder.should.eql(false);
    (file.meta.size || 0).should.eql(7);
    (await drain(file.stream)).toString().should.eql("hello!\n");
  });

  it("writes a nested folder correctly", async () => {
    const contents = Decorate.iterator([ Buffer.from("abc") ]);
    const bottle3 = FileBottle.write({ folder: false, filename: "test.txt", size: 3 }, buffered(contents));
    const bottle2 = FileBottle.write({ folder: true, filename: "inner" }, buffered(bottle3));
    const bottle1 = FileBottle.write({ folder: true, filename: "outer" }, buffered(bottle2));
    const data = await hex(bottle1);

    data.should.eql(
      "f09f8dbc00000900" + // file bottle, header len=9
      "0500" + "6f75746572" + // name(0) = "outer"
      "00c0" + // folder(0)
      "be1c4e48" + // crc
      "35" + // block size=53
        "f09f8dbc00000900" + // file bottle, header len=9
        "0500" + "696e6e6572" + // name(0) = "inner"
        "00c0" + // folder(0)
        "ff54df68" + // crc
        "1e" + // block size=30
          "f09f8dbc00000d00" + // file bottle, header len=13
          "0800" + "746573742e747874" + // name(0) = "test.txt"
          "0180" + "03" + // size(0) = 3
          "4297157f" + // crc
          "03" + // block size=3
            "616263" + // "abc"
          "00" + // end of stream
        "00" + // end of stream
      "00" // end of stream
    );

    const bottle4 = await readBottle(Buffer.from(data, "hex"));
    bottle4.cap.type.should.eql(BottleType.File);
    const outer = await FileBottle.read(bottle4);
    outer.meta.filename.should.eql("outer");
    outer.meta.folder.should.eql(true);

    const bottle5 = await Bottle.read(new Readable(outer.stream));
    bottle5.cap.type.should.eql(BottleType.File);
    const inner = await FileBottle.read(bottle5);
    inner.meta.filename.should.eql("inner");
    inner.meta.folder.should.eql(true);

    const bottle6 = await Bottle.read(new Readable(inner.stream));
    bottle6.cap.type.should.eql(BottleType.File);
    const file = await FileBottle.read(bottle6);
    file.meta.filename.should.eql("test.txt");
    file.meta.folder.should.eql(false);
    (file.meta.size || 0).should.eql(3);
    (await drain(file.stream)).toString().should.eql("abc");
  });
});
