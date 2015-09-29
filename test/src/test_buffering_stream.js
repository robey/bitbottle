"use strict";

import bufferingStream from "../../lib/lib4bottle/buffering_stream";
import { future } from "mocha-sprinkles";

import "should";
import "source-map-support";


describe("bufferingStream", () => {
  it("combines small buffers", future(() => {
    const queue = [];
    const s = bufferingStream();
    s.on("data", data => queue.push(data.toString()));
    s.write("hell");
    s.write("ok");
    s.write("it");
    s.write("ty!");
    s.end();
    return s.endPromise().then(() => {
      queue.should.eql([ "hellokitty!" ]);
    });
  }));

  it("stops when it hits its target", future(() => {
    const queue = [];
    const s = bufferingStream({ blockSize: 5 });
    s.on("data", data => queue.push(data.toString()));
    s.write("hell");
    s.write("ok");
    s.write("it");
    s.write("ty!");
    s.end();
    return s.endPromise().then(() => {
      queue.should.eql([ "hellok", "itty!" ]);
    });
  }));

  it("slices exactly when asked", future(() => {
    const queue = [];
    const s = bufferingStream({ blockSize: 5, exact: true });
    s.on("data", data => queue.push(data.toString()));
    s.write("hell");
    s.write("okittyhowareyou!");
    s.end();
    return s.endPromise().then(() => {
      queue.should.eql([ "hello", "kitty", "howar", "eyou!" ]);
    });
  }));
});
