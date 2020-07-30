import { asyncIter, PushAsyncIterator } from "ballvalve";
import * as fs from "fs";
import { archiveFile, archiveFiles, readArchive } from "../archive";
import { asyncOne } from "../async";
import { Compression, writeCompressedBottle } from "../compressed_bottle";
import { DecryptStatus, Encryption, writeEncryptedBottle } from "../encrypted_bottle";
import { AsyncEvent, BytesEvent, CompressedEvent, countStream, EncryptedEvent, FileEvent, SignedEvent } from "../events";
import { writeSignedBottle, Hash, VerifyOptions, SignedStatus } from "../signed_bottle";
import { drain, makeTempFolder } from "./tools";

import "should";
import "source-map-support/register";


async function* drainFileEvents(events: AsyncIterable<AsyncEvent>): AsyncIterator<AsyncEvent> {
  for await (const e of asyncIter(events)) {
    if (e.event == "file") {
      const fe = e as FileEvent;
      if (fe.content) fe.content = asyncOne(await drain(fe.content));
    }
    yield e;
  }
}


describe("ArchiveWriter", () => {
  const folder = makeTempFolder();

  it("writes a file", async () => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");

    // basic structure and data size
    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFile(`${folder}/test.txt`, events, "test/");
    const data = await drain(bottle.write());
    data.length.should.be.greaterThan(70);
    events.end();
    const eventObjects = await asyncIter(events).collect();
    new Set(eventObjects.map(e => e.event)).should.eql(new Set([ "file" ]));
    new Set(eventObjects.map(e => (e as FileEvent).metadata.filename)).should.eql(new Set([ "test/test.txt" ]));
  });

  it("reads a file", async () => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");
    const data = await drain(archiveFile(`${folder}/test.txt`, undefined, "test/").write());

    const events = await asyncIter(readArchive(asyncOne(data))).collect();
    events.length.should.eql(1);
    events[0].event.should.eql("file");
    (events[0] as FileEvent).metadata.filename.should.eql("test/test.txt");
    const content = (events[0] as FileEvent).content ?? asyncOne(Buffer.alloc(0));
    (await drain(content)).toString().should.eql("hello");
  });

  it("writes a folder", async () => {
    fs.mkdirSync(`${folder}/stuff`);
    fs.writeFileSync(`${folder}/stuff/one.txt`, "one!");
    fs.writeFileSync(`${folder}/stuff/two.txt`, "two!");

    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFile(`${folder}/stuff`, events);
    const data = await drain(bottle.write());
    data.length.should.be.greaterThan(200);
    events.end();
    (await asyncIter(events).collect()).map(e => {
      return { event: e.event, filename: (e as FileEvent).metadata.filename };
    }).should.eql([
      { event: "file", filename: "stuff" },
      { event: "file", filename: "stuff/one.txt" },
      { event: "file", filename: "stuff/two.txt" },
    ]);
  });

  it("reads a folder", async () => {
    fs.mkdirSync(`${folder}/stuff2`);
    fs.writeFileSync(`${folder}/stuff2/one.txt`, "one!");
    fs.writeFileSync(`${folder}/stuff2/two.txt`, "two!");
    const data = await drain(archiveFile(`${folder}/stuff2`).write());

    const events = await asyncIter(drainFileEvents(readArchive(asyncOne(data)))).collect();
    events.length.should.eql(3);
    new Set(events.map(e => e.event)).should.eql(new Set([ "file" ]));
    const fileEvents = events.map(e => e as FileEvent);
    fileEvents[0].metadata.filename.should.eql("stuff2");
    fileEvents[1].metadata.filename.should.eql("stuff2/one.txt");
    fileEvents[2].metadata.filename.should.eql("stuff2/two.txt");
    fileEvents.map(fe => fe.metadata.folder).should.eql([ true, false, false ]);
    (await drain(fileEvents[1].content ?? asyncOne(Buffer.alloc(0)))).toString().should.eql("one!");
    (await drain(fileEvents[2].content ?? asyncOne(Buffer.alloc(0)))).toString().should.eql("two!");
  });

  it("writes an assortment of random files", async () => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");
    fs.writeFileSync(`${folder}/test2.txt`, "goodbye");

    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFiles([ `${folder}/test.txt`, `${folder}/test2.txt` ], events, "stuff");
    const data = await drain(bottle.write());
    data.length.should.be.greaterThan(150);
    events.end();
    (await asyncIter(events).collect()).map(e => {
      return { event: e.event, filename: (e as FileEvent).metadata.filename };
    }).should.eql([
      { event: "file", filename: "stuff" },
      { event: "file", filename: "stuff/test.txt" },
      { event: "file", filename: "stuff/test2.txt" },
    ]);
  });

  it("reads an assortment of random files", async () => {
    fs.writeFileSync(`${folder}/test.txt`, "hello");
    fs.writeFileSync(`${folder}/test2.txt`, "goodbye");
    const data = await drain(archiveFiles([ `${folder}/test.txt`, `${folder}/test2.txt` ], undefined, "stuff").write());

    const events = await asyncIter(drainFileEvents(readArchive(asyncOne(data)))).collect();
    events.length.should.eql(3);
    new Set(events.map(e => e.event)).should.eql(new Set([ "file" ]));
    const fileEvents = events.map(e => e as FileEvent);
    fileEvents[0].metadata.filename.should.eql("stuff");
    fileEvents[1].metadata.filename.should.eql("stuff/test.txt");
    fileEvents[2].metadata.filename.should.eql("stuff/test2.txt");
    fileEvents.map(fe => fe.metadata.folder).should.eql([ true, false, false ]);
    (await drain(fileEvents[1].content ?? asyncOne(Buffer.alloc(0)))).toString().should.eql("hello");
    (await drain(fileEvents[2].content ?? asyncOne(Buffer.alloc(0)))).toString().should.eql("goodbye");
  });

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

  it("creates and reads an encrypted archive", async () => {
    fs.writeFileSync(`${folder}/hello.txt`, "hello, i must be going!");

    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFile(`${folder}/hello.txt`, events, "test/");
    const eBottle = await writeEncryptedBottle(Encryption.AES_128_GCM, bottle.write(), {
      argonKey: Buffer.from("throwing muses")
    });
    const stream = countStream(eBottle.write(), events, "encrypted");

    const data = await drain(stream);
    data.length.should.be.greaterThan(150);
    events.end();
    const collectedEvents = await asyncIter(events).collect();
    new Set(collectedEvents.map(e => e.event)).should.eql(new Set([ "file", "byte-count" ]));
    collectedEvents.filter(e => e.event == "byte-count" && (e as BytesEvent).bytes == 0).length.should.eql(1);
    collectedEvents.filter(e => e.event == "byte-count" && (e as BytesEvent).bytes == data.length).length.should.eql(1);

    const options = {
      getPassword: () => Promise.resolve(Buffer.from("throwing muses"))
    };
    const events2 = await asyncIter(drainFileEvents(readArchive(asyncOne(data), options))).collect();
    events2.length.should.eql(2);
    events2.map(e => e.event).should.eql([ "encrypted", "file" ]);

    const encryptedEvent = events2[0] as EncryptedEvent;
    const fileEvent = events2[1] as FileEvent;
    encryptedEvent.info.should.eql({ status: DecryptStatus.OK });
    fileEvent.metadata.filename.should.eql("test/hello.txt");
    (await drain(fileEvent.content ?? asyncOne(Buffer.alloc(0)))).toString().should.eql("hello, i must be going!");
  });

  it("creates and reads a compressed archive", async () => {
    fs.writeFileSync(`${folder}/hello.txt`, "hello, i must be going!");

    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFile(`${folder}/hello.txt`, events, "test/");
    const cBottle = await writeCompressedBottle(Compression.SNAPPY, bottle.write());
    const stream = countStream(cBottle.write(), events, "compressed");

    const data = await drain(stream);
    data.length.should.be.lessThan(150);
    events.end();
    const collectedEvents = await asyncIter(events).collect();
    new Set(collectedEvents.map(e => e.event)).should.eql(new Set([ "file", "byte-count" ]));
    collectedEvents.filter(e => e.event == "byte-count" && (e as BytesEvent).bytes == 0).length.should.eql(1);
    collectedEvents.filter(e => e.event == "byte-count" && (e as BytesEvent).bytes == data.length).length.should.eql(1);

    const events2 = await asyncIter(drainFileEvents(readArchive(asyncOne(data)))).collect();
    events2.length.should.eql(2);
    events2.map(e => e.event).should.eql([ "compressed", "file" ]);

    const compressedEvent = events2[0] as CompressedEvent;
    const fileEvent = events2[1] as FileEvent;
    compressedEvent.method.should.eql(Compression.SNAPPY);
    fileEvent.metadata.filename.should.eql("test/hello.txt");
    (await drain(fileEvent.content ?? asyncOne(Buffer.alloc(0)))).toString().should.eql("hello, i must be going!");
  });

  it("creates and reads a signed archive", async () => {
    fs.writeFileSync(`${folder}/hello.txt`, "hello, i must be going!");

    const events = new PushAsyncIterator<AsyncEvent>();
    const bottle = archiveFile(`${folder}/hello.txt`, events, "test/");
    const sBottle = await writeSignedBottle(Hash.SHA256, bottle.write(), {
      signedBy: "moof",
      signer: async (data: Buffer) => Buffer.concat([ Buffer.from([ 0 ]), data ]),
    });
    const stream = countStream(sBottle.write(), events, "signed");

    const data = await drain(stream);
    data.length.should.be.greaterThan(150);
    events.end();
    const collectedEvents = await asyncIter(events).collect();
    new Set(collectedEvents.map(e => e.event)).should.eql(new Set([ "file", "byte-count" ]));
    collectedEvents.filter(e => e.event == "byte-count" && (e as BytesEvent).bytes == 0).length.should.eql(1);
    collectedEvents.filter(e => e.event == "byte-count" && (e as BytesEvent).bytes == data.length).length.should.eql(1);

    const options: VerifyOptions = {
      verifier: async (signedDigest: Buffer, signedBy: string) => {
        if (signedBy != "moof") throw new Error("nope");
        return signedDigest.slice(1);
      }
    };
    const events2 = await asyncIter(drainFileEvents(readArchive(asyncOne(data), options))).collect();
    events2.length.should.eql(2);
    events2.map(e => e.event).should.eql([ "file", "signed" ]);

    const fileEvent = events2[0] as FileEvent;
    const signedEvent = events2[1] as SignedEvent;
    fileEvent.metadata.filename.should.eql("test/hello.txt");
    (await drain(fileEvent.content ?? asyncOne(Buffer.alloc(0)))).toString().should.eql("hello, i must be going!");
    signedEvent.method.should.eql(Hash.SHA256);
    signedEvent.verified.status.should.eql(SignedStatus.OK);
    (signedEvent.verified.signedBy ?? "").should.eql("moof");
  });
});
