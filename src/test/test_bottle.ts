import { asyncIter, PushAsyncIterator, Stream } from "ballvalve";
import { Bottle, BottleWriter, BottleReader } from "../bottle";
import { setLogger } from "../debug";
import { Header } from "../header";
import { Readable } from "../readable";

import "should";
import "source-map-support/register";

const MAGIC_STRING = "f09f8dbc0000";
const BASIC_MAGIC = MAGIC_STRING + "00e0";


describe("BottleWriter", () => {
  it("writes a bottle header", async () => {
    const b = new Bottle(10, new Header().addNumber(0, 150)).write();
    b.end();
    Buffer.concat(await asyncIter(b).collect()).toString("hex").should.eql(`${MAGIC_STRING}03a0018096ef`);
  });

  it("writes data", async () => {
    const data = asyncIter([ Buffer.from("ff00ff00", "hex") ]);
    const b = new Bottle(10, new Header()).write();
    b.addStream(data);
    b.end();
    Buffer.concat(await asyncIter(b).collect()).toString("hex").should.eql(
      `${MAGIC_STRING}00a0ed04ff00ff0000ef`
    );
  });

  it("writes a nested bottle", async () => {
    const b = new Bottle(10, new Header()).write();
    const b2 = new Bottle(14, new Header()).write();
    b.addBottle(b2);
    b.end();
    b2.end();
    Buffer.concat(await asyncIter(b).collect()).toString("hex").should.eql(
      `${MAGIC_STRING}00a0ee${MAGIC_STRING}00e0efef`
    );
  });

  it("streams data", async () => {
    // just to verify that the data is written as it comes in, and the event isn't triggered until completion.
    const stream = new PushAsyncIterator<Buffer>();
    const b = new Bottle(14, new Header()).write();
    const future = b.addStream(stream);

    let done = false;
    setTimeout(async () => {
      stream.push(Buffer.from("c44c", "hex"));
      stream.end();

      await future;
      b.end();
      done = true;
    }, 10);

    Buffer.concat(await asyncIter(b).collect()).toString("hex").should.eql(
      `${MAGIC_STRING}00e0ed02c44c00ef`
    );
    done.should.eql(true);
  });

  it("writes several datas", async () => {
    const data1 = asyncIter([ Buffer.from("f0f0f0", "hex") ]);
    const data2 = asyncIter([ Buffer.from("e0e0e0", "hex") ]);
    const data3 = asyncIter([ Buffer.from("cccccc", "hex") ]);
    const b = new Bottle(14, new Header()).write();

    await Promise.all([
      async () => {
        await b.addStream(data1);
        await b.addStream(data2);
        await b.addStream(data3);
        b.end();
      },
      async () => {
        Buffer.concat(await asyncIter(b).collect()).toString("hex").should.eql(
          `${MAGIC_STRING}00e0ed03f0f0f000ed03e0e0e000ed03cccccc00ef`
        );
      }
    ]);
  });
});


describe("bottleReader", () => {
  function read(hex: string): Promise<BottleReader> {
    return Bottle.read(new Readable(asyncIter([ Buffer.from(hex, "hex") ])));
  }

  it("validates the header", async () => {
    await read("00").should.be.rejectedWith(/End of stream/);
    await read("00ff00ff00ff00ff").should.be.rejectedWith(/magic/);
    await read("f09f8dbcff000000").should.be.rejectedWith(/version/);
    await read("f09f8dbc00ff0000").should.be.rejectedWith(/flags/);
  });

  it("reads the header", async () => {
    const b = await read("f09f8dbc000000c0");
    b.bottle.type.should.eql(12);
    b.bottle.header.toString().should.eql("Header()");

    const b2 = await read("f09f8dbc000003e0018096");
    b2.bottle.type.should.eql(14);
    b2.bottle.header.toString().should.eql("Header(I0=150)");
  });

  it("reads a data block", async () => {
    const b = await read(`${BASIC_MAGIC}ed0568656c6c6f00ef`);
    const stream1 = (await b.next()).value;
    (stream1 instanceof BottleReader).should.eql(false);
    if (!(stream1 instanceof BottleReader)) {
      Buffer.concat(await asyncIter(stream1).collect()).toString().should.eql("hello");
    }
    (await b.next()).done.should.eql(true);
  });

  it("reads a continuing data block", async () => {
    const b = await read(`${BASIC_MAGIC}ed026865016c026c6f00ef`);
    const stream1 = (await b.next()).value;
    (stream1 instanceof BottleReader).should.eql(false);
    if (!(stream1 instanceof BottleReader)) {
      Buffer.concat(await asyncIter(stream1).collect()).toString().should.eql("hello");
    }
    (await b.next()).done.should.eql(true);
  });

  it("reads several datas", async () => {
    const b = await read(`${BASIC_MAGIC}ed03f0f0f000ed03e0e0e000ed03cccccc00ef`);

    const stream1 = (await b.next()).value;
    (stream1 instanceof BottleReader).should.eql(false);
    if (!(stream1 instanceof BottleReader)) {
      Buffer.concat(await asyncIter(stream1).collect()).toString("hex").should.eql("f0f0f0");
    }

    const stream2 = (await b.next()).value;
    (stream2 instanceof BottleReader).should.eql(false);
    if (!(stream2 instanceof BottleReader)) {
      Buffer.concat(await asyncIter(stream2).collect()).toString("hex").should.eql("e0e0e0");
    }

    const stream3 = (await b.next()).value;
    (stream3 instanceof BottleReader).should.eql(false);
    if (!(stream3 instanceof BottleReader)) {
      Buffer.concat(await asyncIter(stream3).collect()).toString("hex").should.eql("cccccc");
    }

    (await b.next()).done.should.eql(true);
  });

  it("reads several bottles from the same stream", async () => {
    const r = new Readable(asyncIter([
      Buffer.from(`${BASIC_MAGIC}ed0363617400ef${BASIC_MAGIC}ed0368617400ef`, "hex")
    ]));

    const b1 = (await Bottle.read(r));
    const stream1 = (await b1.next()).value;
    (stream1 instanceof BottleReader).should.eql(false);
    if (!(stream1 instanceof BottleReader)) {
      Buffer.concat(await asyncIter(stream1).collect()).toString().should.eql("cat");
    }
    (await b1.next()).done.should.eql(true);

    const b2 = (await Bottle.read(r));
    const stream2 = (await b2.next()).value;
    (stream2 instanceof BottleReader).should.eql(false);
    if (!(stream2 instanceof BottleReader)) {
      Buffer.concat(await asyncIter(stream2).collect()).toString().should.eql("hat");
    }
    (await b2.next()).done.should.eql(true);
  });

  it("reads nested bottles", async () => {
    const b = await read(`${MAGIC_STRING}00a0ee${MAGIC_STRING}00b0ed0363617400efed0363617400ef`);
    b.bottle.type.should.eql(10);

    const stream1 = (await b.next()).value;
    (stream1 instanceof BottleReader).should.eql(true);
    if (stream1 instanceof BottleReader) {
      stream1.bottle.type.should.eql(11);

      const stream2 = (await stream1.next()).value;
      (stream2 instanceof BottleReader).should.eql(false);
      if (!(stream2 instanceof BottleReader)) {
        Buffer.concat(await asyncIter(stream2).collect()).toString().should.eql("cat");
      }
      (await stream1.next()).done.should.eql(true);
    }

    const stream2 = (await b.next()).value;
    (stream2 instanceof BottleReader).should.eql(false);
    if (!(stream2 instanceof BottleReader)) {
      Buffer.concat(await asyncIter(stream2).collect()).toString().should.eql("cat");
    }
    (await b.next()).done.should.eql(true);
  });
});
