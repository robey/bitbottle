import { asyncIter, byteReader } from "ballvalve";
import { buffered, framed, unframed } from "../framed";

import "should";
import "source-map-support/register";

describe("framed", () => {
  it("writes a small frame", async () => {
    const stream = asyncIter([ Buffer.from([ 1, 2, 3 ]) ]);
    Buffer.concat(await asyncIter(framed(stream)).collect()).toString("hex").should.eql("03010203");
  });

  it("buffers up a frame", async () => {
    const stream = asyncIter([ "he", "ll", "o sai", "lor" ].map(s => Buffer.from(s)));
    Buffer.concat(await asyncIter(framed(buffered(stream))).collect()).toString("hex").should.eql(
      "0c68656c6c6f207361696c6f72"
    );
  });

  it("ignores empty buffers", async () => {
    const stream = asyncIter([ Buffer.from("he"), Buffer.alloc(0), Buffer.from("llo") ]);
    Buffer.concat(await asyncIter(framed(stream)).collect()).toString("hex").should.eql("0568656c6c6f");
  })

  it("writes power-of-two frames", async () => {
    for (const blockSize of [ 128, 1024, 8192, Math.pow(2, 18), Math.pow(2, 21) ]) {
      const stream = asyncIter([ Buffer.alloc(blockSize) ]);
      const data = Buffer.concat(await asyncIter(framed(stream, Math.pow(2, 22))).collect());
      data.length.should.eql(blockSize + 2);
      const scale = Math.floor(Math.log(blockSize) / Math.log(64));
      const frameLen = blockSize / Math.pow(64, scale);
      data[0].should.eql((scale << 6) | frameLen);
      data[data.length - 1].should.eql(0);
    }
  });

  it("splits an odd chunk into frames", async () => {
    const stream = asyncIter([ Buffer.alloc(70) ]);
    const data = Buffer.concat(await asyncIter(framed(stream)).collect());
    data.length.should.eql(72);
    // 70 = 1 * 64 + 6
    data[0].should.eql(0x41);
    data[65].should.eql(0x06);
  });

  it("splits a large odd chunk into 4 frames", async () => {
    const stream = asyncIter([ Buffer.alloc(0x7eedd) ]);
    const data = Buffer.concat(await asyncIter(framed(stream)).collect());
    data.length.should.eql(0x7eedd + 4);
    // 1, 3e, 3b, 1d
    data[0].should.eql(0xc0 + 0x01);
    data[1 + 0x40000].should.eql(0x80 + 0x3e);
    data[2 + 0x7e000].should.eql(0x40 + 0x3b);
    data[3 + 0x7eec0].should.eql(0x1d);
  });
});

describe("unframed", () => {
  it("reads a simple frame", async () => {
    const stream = asyncIter([ Buffer.from("03010203", "hex") ]);
    Buffer.concat(await asyncIter(unframed(byteReader(stream))).collect()).toString("hex").should.eql("010203");
  });

  it("reads power-of-two frames", async () => {
    for (const blockSize of [ 128, 1024, 8192, Math.pow(2, 18), Math.pow(2, 21) ]) {
      const b = Buffer.alloc(blockSize + 2);
      const scale = Math.floor(Math.log(blockSize) / Math.log(64));
      const frameLen = blockSize / Math.pow(64, scale);
      b[0] = (scale << 6) | frameLen;

      const stream = asyncIter([ b ]);
      Buffer.concat(await asyncIter(unframed(byteReader(stream))).collect()).length.should.eql(blockSize);
    }
  });

  it("reads an odd chunk of 2 frames", async () => {
    const b = Buffer.alloc(72);
    b[0] = 0x41;
    b[65] = 0x06;
    const stream = asyncIter([ b ]);
    Buffer.concat(await asyncIter(unframed(byteReader(stream))).collect()).length.should.eql(70);
  });

  it("reads a 4-frame chunk", async () => {
    const b = Buffer.alloc(0x7eedd + 4);
    b[0] = 0xc0 + 0x01;
    b[1 + 0x40000] = 0x80 + 0x3e;
    b[2 + 0x7e000] = 0x40 + 0x3b;
    b[3 + 0x7eec0] = 0x1d;
    const stream = asyncIter([ b ]);
    Buffer.concat(await asyncIter(unframed(byteReader(stream))).collect()).length.should.eql(0x7eedd);
  });
});
