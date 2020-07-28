import { asyncIter, PushAsyncIterator } from "ballvalve";
import * as fs from "fs";
import { archiveFile, archiveFiles, FileBottleAndEvents } from "../archive";
import { Bottle } from "../bottle";
import { Encryption, writeEncryptedBottle } from "../encrypted_bottle";
import { AsyncEvent, FileEvent } from "../events";
import { drain, makeTempFolder } from "./tools";

import "should";
import "source-map-support/register";

function merge(archive: FileBottleAndEvents): AsyncIterator<AsyncEvent> {
  const bottleEvents = asyncIter(archive.bottle.write()).map(data => ({ event: "data", data: data.toString("hex") }));
  return bottleEvents.merge(asyncIter(archive.events));
}

describe("ArchiveWriter", () => {
  const folder = makeTempFolder();

  it("processes a file", async () => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");

    // basic structure and data size
    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFile(`${folder}/test.txt`, events, "test/");
    const data = await drain(bottle.write());
    data.length.should.eql(81);
    events.end();
    const eventObjects = await asyncIter(events).collect();
    new Set(eventObjects.map(e => e.event)).should.eql(new Set([ "file" ]));
    new Set(eventObjects.map(e => (e as FileEvent).metadata.filename)).should.eql(new Set([ "test/test.txt" ]));
  });

  it("processes a folder", async () => {
    fs.mkdirSync(`${folder}/stuff`);
    fs.writeFileSync(`${folder}/stuff/one.txt`, "one!");
    fs.writeFileSync(`${folder}/stuff/two.txt`, "two!");

    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFile(`${folder}/stuff`, events);
    const data = await drain(bottle.write());
    data.length.should.eql(227);
    events.end();
    (await asyncIter(events).collect()).map(e => {
      return { event: e.event, filename: (e as FileEvent).metadata.filename };
    }).should.eql([
      { event: "file", filename: "stuff" },
      { event: "file", filename: "stuff/one.txt" },
      { event: "file", filename: "stuff/two.txt" },
    ]);
  });

  it("processes files", async () => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");
    fs.writeFileSync(`${folder}/test2.txt`, "goodbye");

    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFiles([ `${folder}/test.txt`, `${folder}/test2.txt` ], events, "stuff");
    const data = await drain(bottle.write());
    data.length.should.eql(190);
    events.end();
    (await asyncIter(events).collect()).map(e => {
      return { event: e.event, filename: (e as FileEvent).metadata.filename };
    }).should.eql([
      { event: "file", filename: "stuff" },
      { event: "file", filename: "stuff/test.txt" },
      { event: "file", filename: "stuff/test2.txt" },
    ]);
  });

  // // FIXME: read the archive too?

  it("interleaves events", async () => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");
    fs.writeFileSync(`${folder}/test2.txt`, "goodbye");

    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFiles([ `${folder}/test.txt`, `${folder}/test2.txt` ], events, "stuff");
    const stream = await asyncIter(bottle.write())
      .map(data => ({ event: "data", data }))
      .after(async () => events.end())
      .merge(events).collect();

    // don't worry about the races & interleaving, but it should end with
    // data, and have 3 non-consecutive file events.
    stream[stream.length - 1].event.should.eql("data");
    const lines = stream
      .map((e, i) => [ e.event, i ] as [ string, number ])
      .filter(([ e, i ]) => e == "file")
      .map(([ e, i ]) => i);
    lines.length.should.eql(3);
    Math.abs(lines[1] - lines[0]).should.be.greaterThan(1);
    Math.abs(lines[2] - lines[1]).should.be.greaterThan(1);
  });

  // it("creates and reads an encrypted archive", async () => {
  //   fs.writeFileSync(`${folder}/hello.txt`, "hello, i must be going!");

  //   const { bottle, events } = archiveFile(`${folder}/hello.txt`, "test/");
  //   const eBottle = await writeEncryptedBottle(Encryption.AES_128_GCM, bottle, {
  //     argonKey: Buffer.from("throwing muses")
  //   });
  //   const { stream, countEvents: eEvents } = countingStream(eBottle.write(), "", "encrypted");
  //   const totalEvents = asyncIter(events).merge(asyncIter(eEvents));

  //   const data = await drain(stream);
  //   data.length.should.eql(182);
  //   new Set((await asyncIter(totalEvents).collect()).map(e => e.event)).should.eql(new Set([ "file", "encrypted" ]));

  //   // const options = {
  //   //     getPassword: () => Promise.resolve("throwing muses")
  //   //   };
  //   //   return scan(sourceStream(data), options).then(events => {
  //   //     events.map(e => e.event).should.eql([
  //   //       "enter-encrypt",
  //   //       "file",
  //   //       "exit-encrypt"
  //   //     ]);
  //   //     events[1].data.toString().should.eql("hello, i must be going!");
  //   //   });
  //   // });
  // });
});


        // w.collectedEvents.filter(e => e.event == "filename").map(e => e.filename).should.eql([ "test.txt" ]);
