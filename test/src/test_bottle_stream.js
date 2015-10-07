"use strict";

import Promise from "bluebird";
import stream from "stream";
import bufferingStream from "../../lib/lib4bottle/buffering_stream";
import { pipeToBuffer, sourceStream } from "stream-toolkit";
import { future } from "mocha-sprinkles";
import { Header } from "../../lib/lib4bottle/bottle_header";
import { bottleWriter } from "../../lib/lib4bottle/bottle_stream";

import "should";
import "source-map-support/register";

const MAGIC_STRING = "f09f8dbc0000";
// const BASIC_MAGIC = MAGIC_STRING + "e000";

// function shouldThrow(promise, message) {
//   return promise.then(() => {
//     throw new Error("Expected exception, got valid promise");
//   }, error => {
//     (() => {
//       throw error;
//     }).should.throw(message);
//   });
// }


describe("bottleWriter", () => {
  it("writes a bottle header", future(() => {
    const h = new Header();
    h.addNumber(0, 150);
    const b = bottleWriter(10, h);
    b.end();
    return pipeToBuffer(b).then(data => {
      data.toString("hex").should.eql(`${MAGIC_STRING}a003800196ff`);
    });
  }));

  it("writes data", future(() => {
    const data = sourceStream(new Buffer("ff00ff00", "hex"));
    const b = bottleWriter(10, new Header());
    b.write(data);
    b.end();
    return pipeToBuffer(b).then(data => {
      data.toString("hex").should.eql(`${MAGIC_STRING}a00004ff00ff0000ff`);
    });
  }));

  it("writes nested bottle data", future(() => {
    const b = new bottleWriter(10, new Header());
    const b2 = new bottleWriter(14, new Header());
    b.write(b2.pipe(bufferingStream()));
    b.end();
    b2.end();
    return pipeToBuffer(b).then(data => {
      data.toString("hex").should.eql(`${MAGIC_STRING}a00009${MAGIC_STRING}e000ff00ff`);
    });
  }));

  it("streams data", future(() => {
    // just to verify that the data is written as it comes in, and the event isn't triggered until completion.
    const data = new Buffer("c44c", "hex");
    const slowStream = new stream.Readable();
    slowStream._read = () => null;
    slowStream.push(data);
    const b = new bottleWriter(14, new Header());
    Promise.delay(100).then(() => {
      slowStream.push(data);
      Promise.delay(100).then(() => {
        slowStream.push(null);
      });
    });
    b.write(slowStream.pipe(bufferingStream()));
    b.end();
    return pipeToBuffer(b).then(data => {
      data.toString("hex").should.eql(`${MAGIC_STRING}e00004c44cc44c00ff`);
    });
  }));

  it("writes several datas", future(() => {
    const data1 = sourceStream(new Buffer("f0f0f0", "hex"));
    const data2 = sourceStream(new Buffer("e0e0e0", "hex"));
    const data3 = sourceStream(new Buffer("cccccc", "hex"));
    const b = bottleWriter(14, new Header());
    b.write(data1);
    b.write(data2);
    b.write(data3);
    b.end();
    return pipeToBuffer(b).then(data => {
      data.toString("hex").should.eql(`${MAGIC_STRING}e00003f0f0f00003e0e0e00003cccccc00ff`);
    });
  }));
});


describe("BottleReader", () => {
//   it("validates the header", future(() => {
//     let b = bottle_stream.readBottleFromStream(toolkit.sourceStream(new Buffer("00", "hex")));
//     return shouldQThrow(b, /magic/).then(() => {
//       b = bottle_stream.readBottleFromStream(toolkit.sourceStream(new Buffer("f09f8dbcff000000", "hex")));
//       return shouldQThrow(b, /version/);
//     }).then(() => {
//       b = bottle_stream.readBottleFromStream(toolkit.sourceStream(new Buffer("f09f8dbc00ff0000", "hex")));
//       return shouldQThrow(b, /flags/);
//     });
//   }));
//
//   it("reads the header", future(() => {
//     return bottle_stream.readBottleFromStream(toolkit.sourceStream(new Buffer("f09f8dbc0000c000", "hex"))).then((b) => {
//       b.header.fields.length.should.eql(0);
//       b.type.should.eql(12);
//       return bottle_stream.readBottleFromStream(toolkit.sourceStream(new Buffer("f09f8dbc0000e003800196", "hex"))).then((b) => {
//         b.header.fields.length.should.eql(1);
//         b.header.fields[0].number.should.eql(150);
//         b.type.should.eql(14);
//       });
//     });
//   }));
//
//   it("reads a data block", future(() => {
//     return bottle_stream.readBottleFromStream(toolkit.sourceStream(new Buffer(`${BASIC_MAGIC}0568656c6c6f00ff`, "hex"))).then((b) => {
//       return b.readPromise().then((dataStream) => {
//         return toolkit.pipeToBuffer(dataStream).then((data) => {
//           data.toString().should.eql("hello");
//           return b.readPromise().then((dataStream) => {
//             (dataStream == null).should.eql(true);
//           });
//         });
//       });
//     });
//   }));
//
//   it("reads a continuing data block", future(() => {
//     return bottle_stream.readBottleFromStream(toolkit.sourceStream(new Buffer(`${BASIC_MAGIC}026865016c026c6f00ff`, "hex"))).then((b) => {
//       return b.readPromise().then((dataStream) => {
//         return toolkit.pipeToBuffer(dataStream).then((data) => {
//           data.toString().should.eql("hello");
//           return b.readPromise().then((data) => {
//             (data == null).should.eql(true);
//           });
//         });
//       });
//     });
//   }));
//
//   it("reads several datas", future(() => {
//     return bottle_stream.readBottleFromStream(toolkit.sourceStream(new Buffer(`${BASIC_MAGIC}03f0f0f00003e0e0e00003cccccc00ff`, "hex"))).then(b => {
//       return b.readPromise().then((dataStream) => {
//         return toolkit.pipeToBuffer(dataStream).then(data => {
//           data.toString("hex").should.eql("f0f0f0");
//           return b.readPromise();
//         });
//       }).then(dataStream => {
//         return toolkit.pipeToBuffer(dataStream).then(data => {
//           data.toString("hex").should.eql("e0e0e0");
//           return b.readPromise();
//         });
//       }).then(dataStream => {
//         return toolkit.pipeToBuffer(dataStream).then(data => {
//           data.toString("hex").should.eql("cccccc");
//           return b.readPromise();
//         });
//       }).then(dataStream => {
//         (dataStream == null).should.eql(true);
//       });
//     });
//   }));
//
//   it("reads several bottles from the same stream", future(() => {
//     const source = toolkit.sourceStream(new Buffer(`${BASIC_MAGIC}0363617400ff${BASIC_MAGIC}0368617400ff`, "hex"));
//     return bottle_stream.readBottleFromStream(source).then((b) => {
//       return toolkit.qread(b).then(dataStream => {
//         return toolkit.pipeToBuffer(dataStream).then((data) => {
//           data.toString().should.eql("cat");
//           return toolkit.qread(b);
//         });
//       }).then(dataStream => {
//         (dataStream == null).should.eql(true);
//         return bottle_stream.readBottleFromStream(source);
//       });
//     }).then(b => {
//       return toolkit.qread(b).then(dataStream => {
//         return toolkit.pipeToBuffer(dataStream).then((data) => {
//           data.toString().should.eql("hat");
//           return toolkit.qread(b);
//         });
//       }).then(dataStream => {
//         (dataStream == null).should.eql(true);
//         return bottle_stream.readBottleFromStream(source);
//       });
//     }).then(() => {
//       throw new Error("expected end of stream");
//     }, () => null);
//   }));
});
