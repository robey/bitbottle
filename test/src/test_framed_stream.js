"use strict";

import { framingStream, unframingStream } from "../../lib/lib4bottle/framed_stream";
import { bufferStream, pipeToBuffer, sourceStream } from "stream-toolkit";
import { future } from "mocha-sprinkles";

import "should";
import "source-map-support";


describe("framingStream", () => {
  it("writes a small frame", future(() => {
    const fs = framingStream();
    const p = pipeToBuffer(fs);
    fs.write(new Buffer([ 1, 2, 3 ]));
    fs.end();
    return p.then(data => {
      data.toString("hex").should.eql("0301020300");
    });
  }));

  it("buffers up a frame", future(() => {
    const bs = bufferStream();
    const fs = framingStream();
    bs.pipe(fs);
    const p = pipeToBuffer(fs);
    bs.write(new Buffer("he"));
    bs.write(new Buffer("ll"));
    bs.write(new Buffer("o sai"));
    bs.write(new Buffer("lor"));
    bs.end();
    return p.then(data => {
      data.toString("hex").should.eql("0c68656c6c6f207361696c6f7200");
    });
  }));

  it("writes a power-of-two frame", future(() => {
    return Promise.all([ 128, 1024, Math.pow(2, 18), Math.pow(2, 21) ].map(blockSize => {
      const fs = framingStream();
      const p = pipeToBuffer(fs);
      const b = new Buffer(blockSize);
      b.fill(0);
      fs.write(b);
      fs.end();
      return p.then(data => {
        data.length.should.eql(blockSize + 2);
        data[0].should.eql((Math.log(blockSize) / Math.log(2)) + 0xf0 - 7);
      });
    }));
  }));

  it("writes a medium (< 8K) frame", future(() => {
    return Promise.all([ 129, 1234, 8191 ].map(blockSize => {
      const fs = framingStream();
      const p = pipeToBuffer(fs);
      const b = new Buffer(blockSize);
      b.fill(0);
      fs.write(b);
      fs.end();
      return p.then(data => {
        data.length.should.eql(blockSize + 3);
        data[0].should.eql((blockSize & 0x3f) + 0x80);
        data[1].should.eql(blockSize >> 6);
      });
    }));
  }));

  it("writes a large (< 2M) frame", future(() => {
    return Promise.all([ 8193, 12345, 456123 ].map(blockSize => {
      const fs = framingStream();
      const p = pipeToBuffer(fs);
      const b = new Buffer(blockSize);
      b.fill(0);
      fs.write(b);
      fs.end();
      return p.then(data => {
        data.length.should.eql(blockSize + 4);
        data[0].should.eql((blockSize & 0x1f) + 0xc0);
        data[1].should.eql((blockSize >> 5) & 0xff);
        data[2].should.eql((blockSize >> 13));
      });
    }));
  }));

  it("writes a huge (>= 2M) frame", future(() => {
    return Promise.all([ Math.pow(2, 21) + 1, 3998778 ].map(blockSize => {
      const fs = framingStream();
      const p = pipeToBuffer(fs);
      const b = new Buffer(blockSize);
      b.fill(0);
      fs.write(b);
      fs.end();
      return p.then(data => {
        data.length.should.eql(blockSize + 5);
        data[0].should.eql((blockSize & 0xf) + 0xe0);
        data[1].should.eql((blockSize >> 4) & 0xff);
        data[2].should.eql((blockSize >> 12) & 0xff);
        data[3].should.eql((blockSize >> 20) & 0xff);
      });
    }));
  }));
});

describe("unframingStream", () => {
  it("reads a simple frame", future(() => {
    const fs = unframingStream();
    sourceStream(new Buffer("0301020300", "hex")).pipe(fs);
    return pipeToBuffer(fs).then(data => {
      data.toString("hex").should.eql("010203");
    });
  }));

  it("reads a block of many frames", future(() => {
    const fs = unframingStream();
    sourceStream(new Buffer("0468656c6c056f20736169036c6f7200", "hex")).pipe(fs);
    return pipeToBuffer(fs).then(data => {
      data.toString().should.eql("hello sailor");
    });
  }));

  // it("can pipe two framed streams from the same source", future(() => {
  //   const fs = unframingStream();
  //   toolkit.sourceStream(new Buffer("0568656c6c6f00067361696c6f7200", "hex")).pipe(fs);
  //   return toolkit.pipeToBuffer(fs).then(data => {
  //     data.toString().should.eql("hello");
  //     const fs2 = unframingStream();
  //
  //     return toolkit.pipeToBuffer(framed_stream.readableFramedStream(source)).then(data => {
  //       data.toString().should.eql("sailor");
  //     });
  //   });
  // }));

  it("reads a power-of-two frame", future(() => {
    return Promise.all([ 128, 1024, Math.pow(2, 18), Math.pow(2, 21) ].map(blockSize => {
      const b = new Buffer(blockSize + 2);
      b.fill(0);
      b[0] = 0xf0 + (Math.log(blockSize) / Math.log(2)) - 7;
      const fs = unframingStream();
      sourceStream(b).pipe(fs);
      return pipeToBuffer(fs).then(data => {
        data.length.should.eql(blockSize);
      });
    }, { concurrency: 1 }));
  }));

  it("reads a medium (< 8K) frame", future(() => {
    return Promise.all([ 129, 1234, 8191 ].map(blockSize => {
      const b = new Buffer(blockSize + 3);
      b.fill(0);
      b[0] = 0x80 + (blockSize & 0x3f);
      b[1] = blockSize >> 6;
      const fs = unframingStream();
      sourceStream(b).pipe(fs);
      return pipeToBuffer(fs).then(data => {
        data.length.should.eql(blockSize);
      });
    }));
  }));

  it("reads a large (< 2M) frame", future(() => {
    return Promise.all([ 8193, 12345, 456123 ].map(blockSize => {
      const b = new Buffer(blockSize + 4);
      b.fill(0);
      b[0] = 0xc0 + (blockSize & 0x1f);
      b[1] = (blockSize >> 5) & 0xff;
      b[2] = blockSize >> 13;
      const fs = unframingStream();
      sourceStream(b).pipe(fs);
      return pipeToBuffer(fs).then(data => {
        data.length.should.eql(blockSize);
      });
    }));
  }));

  it("reads a huge (>= 2M) frame", future(() => {
    return Promise.all([ Math.pow(2, 21) + 1, 3998778 ].map(blockSize => {
      const b = new Buffer(blockSize + 5);
      b.fill(0);
      b[0] = 0xe0 + (blockSize & 0xf);
      b[1] = (blockSize >> 4) & 0xff;
      b[2] = (blockSize >> 12) & 0xff;
      b[3] = (blockSize >> 20) & 0xff;
      const fs = unframingStream();
      sourceStream(b).pipe(fs);
      return pipeToBuffer(fs).then(data => {
        data.length.should.eql(blockSize);
      });
    }));
  }));
});
