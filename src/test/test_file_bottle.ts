import * as fs from "fs";
import * as path from "path";
import { byteReader, StreamAsyncIterator } from "ballvalve";
import * as bigInt from "big-integer";
import { asyncify, asyncOne } from "../async";
import { Bottle } from "../bottle";
import { BottleType } from "../bottle_cap";
import { FileBottle, FileMetadata, statsToMetadata } from "../file_bottle";
import { drain, fromHex, hex, makeTempFolder } from "./tools";

import "should";
import "source-map-support/register";

describe("FileBottle.write", () => {
  it("writes and decodes from data", async () => {
    const meta: FileMetadata = {
      filename: "bogus.txt",
      folder: false,
      posixMode: 7,
      size: bigInt(10),
      createdNanos: bigInt(1234567890),
      user: "tyrion"
    };
    const bottleStream = new FileBottle(meta, asyncify([ asyncOne(Buffer.from("television")) ])).write();

    const bottle = await Bottle.read(byteReader(bottleStream.write()));
    bottle.cap.type.should.eql(BottleType.FILE);
    const file = await FileBottle.read(bottle);

    file.meta.filename.should.eql("bogus.txt");
    file.meta.folder.should.eql(false);
    (file.meta.posixMode || 0).should.eql(7);
    (file.meta.createdNanos || bigInt["0"]).should.eql(bigInt(1234567890));
    (file.meta.size || bigInt["0"]).should.eql(bigInt(10));
    (file.meta.user || "?").should.eql("tyrion");

    const contents = await file.readFileContents();
    (await drain(contents)).toString().should.eql("television");
  });

  it("writes and decodes an actual file", async () => {
    const filename = path.join(makeTempFolder(), "test.txt");
    fs.writeFileSync(filename, "hello!\n");
    const stats = fs.statSync(filename);
    const stream = new StreamAsyncIterator(fs.createReadStream(filename));
    const bottleStream = new FileBottle(statsToMetadata(filename, stats), asyncOne(stream)).write();

    const bottle = await Bottle.read(byteReader(bottleStream.write()));
    bottle.cap.type.should.eql(BottleType.FILE);
    const file = await FileBottle.read(bottle);
    file.meta.filename.should.eql(filename);
    file.meta.folder.should.eql(false);
    (file.meta.size || bigInt["0"]).should.eql(bigInt(7));

    const contents = await file.readFileContents();
    (await drain(contents)).toString().should.eql("hello!\n");
  });

  it("writes and decodes a folder", async () => {
    const contents1 = asyncify([ Buffer.from("abc") ]);
    const contents2 = asyncify([ Buffer.from("defghij") ]);
    const bottle1 = new FileBottle({ folder: false, filename: "test1.txt", size: bigInt(3) }, asyncOne(contents1));
    const bottle2 = new FileBottle({ folder: false, filename: "test2.txt", size: bigInt(7) }, asyncOne(contents2));
    const bottle = new FileBottle(
      { folder: true, filename: "folder" },
      asyncify([ bottle1.write(), bottle2.write() ]),
    );

    const rBottle = await Bottle.read(byteReader(bottle.write().write()));
    rBottle.cap.type.should.eql(BottleType.FILE);
    const folder = await FileBottle.read(rBottle);
    folder.meta.should.eql({ folder: true, filename: "folder" });

    const file1 = await folder.nextBottle();
    (file1 === undefined).should.eql(false);
    if (!file1) return;
    const f1 = await FileBottle.read(file1);
    f1.meta.should.eql({ folder: false, filename: "test1.txt", size: bigInt(3) });
    (await drain(await f1.readFileContents())).toString().should.eql("abc");

    const file2 = await folder.nextBottle();
    (file2 === undefined).should.eql(false);
    if (!file2) return;
    const f2 = await FileBottle.read(file2);
    f2.meta.should.eql({ folder: false, filename: "test2.txt", size: bigInt(7) });
    (await drain(await f2.readFileContents())).toString().should.eql("defghij");

    ((await folder.nextBottle()) === undefined).should.eql(true);
  });

  it("writes a nested folder correctly", async () => {
    const contents = asyncify([ Buffer.from("abc") ]);
    const bottle3 = new FileBottle({ folder: false, filename: "test.txt", size: bigInt(3) }, asyncOne(contents)).write();
    const bottle2 = new FileBottle({ folder: true, filename: "inner" }, asyncOne(bottle3)).write();
    const bottle1 = new FileBottle({ folder: true, filename: "outer" }, asyncOne(bottle2)).write();
    const data = await hex(bottle1.write());

    data.should.eql(
      "f09f8dbc00000800" + // file bottle, header len=8
      "9005" + "6f75746572" + // name(0) = "outer"
      "80" + // folder(0)
      "6df862c4" + // crc
      "80" + // bottle
        "f09f8dbc00000800" + // file bottle, header len=8
        "9005" + "696e6e6572" + // name(0) = "inner"
        "80" + // folder(0)
        "180aaf3a" + // crc
        "80" + // bottle
          "f09f8dbc00000c00" + // file bottle, header len=12
          "9008" + "746573742e747874" + // name(0) = "test.txt"
          "0003" + // size(0) = 3
          "639e4550" + // crc
          "40" + // data
            "03" + "616263" + // "abc"
          "c0" + // end of stream
        "c0" + // end of stream
      "c0" // end of stream
    );

    const bottle4 = await Bottle.read(byteReader(fromHex(data)));
    bottle4.cap.type.should.eql(BottleType.FILE);
    const outer = await FileBottle.read(bottle4);
    outer.meta.filename.should.eql("outer");
    outer.meta.folder.should.eql(true);

    const bottle5 = await outer.nextBottle();
    (bottle5 === undefined).should.eql(false);
    if (!bottle5) return;
    bottle5.cap.type.should.eql(BottleType.FILE);
    const inner = await FileBottle.read(bottle5);
    inner.meta.filename.should.eql("inner");
    inner.meta.folder.should.eql(true);

    const bottle6 = await inner.nextBottle();
    (bottle6 === undefined).should.eql(false);
    if (!bottle6) return;
    bottle6.cap.type.should.eql(BottleType.FILE);
    const file = await FileBottle.read(bottle6);
    file.meta.filename.should.eql("test.txt");
    file.meta.folder.should.eql(false);
    (file.meta.size || 0).should.eql(bigInt(3));
    (await drain(await file.readFileContents())).toString().should.eql("abc");

    ((await inner.nextBottle()) === undefined).should.eql(true);
    ((await outer.nextBottle()) === undefined).should.eql(true);
  });
});
