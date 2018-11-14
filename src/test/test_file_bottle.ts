import { Decorate, Stream } from "ballvalve";
import { Bottle, BottleCap, BottleType } from "../bottle";
import { FileBottle, FileMetadata } from "../file_bottle";
import { Readable } from "../readable";

import "should";
import "source-map-support/register";

async function drain(s: Stream): Promise<Buffer> {
  return Buffer.concat(await Decorate.asyncIterator(s).collect());
}

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

  // it("writes and decodes an actual file", future(withTempFolder(folder => {
  //   const filename = `${folder}/test.txt`;
  //   fs.writeFileSync(filename, "hello!\n");
  //   const stats = fs.statSync(filename);
  //   stats.filename = filename;
  //   const bottle = writeFileBottle(stats);
  //   bottle.write(fs.createReadStream(filename));
  //   bottle.end();
  //   return pipeToBuffer(bottle).then(data => {
  //     // now decode it.
  //     const reader = readBottle();
  //     sourceStream(data).pipe(reader);
  //     return reader.readPromise().then(data => {
  //       data.type.should.eql(TYPE_FILE);
  //       const header = decodeFileHeader(data.header);

  //       header.filename.should.eql(`${folder}/test.txt`);
  //       header.folder.should.eql(false);
  //       header.size.should.eql(7);
  //       return reader.readPromise().then(fileStream => {
  //         return pipeToBuffer(fileStream).then(data => {
  //           data.toString().should.eql("hello!\n");
  //         });
  //       });
  //     });
  //   });
  // })));

  // it("writes a nested folder correctly", future(() => {
  //   const bottle1 = writeFolderBottle({ filename: "outer" });
  //   const bottle2 = writeFolderBottle({ filename: "inner" });
  //   const bottle3 = writeFileBottle({ filename: "test.txt", size: 3 });
  //   bottle3.write(sourceStream("abc"));
  //   bottle3.end();
  //   // wire it up!
  //   bottle1.write(bottle2);
  //   bottle1.end();
  //   bottle2.write(bottle3);
  //   bottle2.end();
  //   return pipeToBuffer(bottle1).then(data => {
  //     data.toString("hex").should.eql(
  //       "f09f8dbc0000000900056f75746572c0002ff09f8dbc000000090005696e6e6572c0001bf09f8dbc0000000d0008746573742e7478748001030361626300ff00ff00ff"
  //     );
  //     // f09f8dbc 00000009
  //     //   0005 6f75746572  // "outer"
  //     //   c000             // folder
  //     //   2f
  //     //     f09f8dbc 00000009
  //     //     0005 696e6e6572  // "inner"
  //     //     c000             // folder
  //     //     1b
  //     //       f09f8dbc 0000000d
  //     //       0008 746573742e747874  // "test.txt"
  //     //       800103                 // size=3
  //     //       03
  //     //         616263
  //     //       00 ff
  //     //     00 ff
  //     //   00 ff
  //   });
  // }));
});
