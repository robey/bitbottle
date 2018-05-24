import { asyncIter } from "ballvalve";
import { buffered } from "../buffered";

import "should";
import "source-map-support/register";

describe("bufferStream", () => {
  it("combines small buffers", async () => {
    const stream = asyncIter([ "hell", "ok", "it", "ty!" ].map(s => Buffer.from(s)));
    (await asyncIter(buffered(stream)).collect()).map(b => b.toString()).should.eql([ "hellokitty!" ]);
  });

  it("stops when it hits its target", async () => {
    const stream = asyncIter([ "hell", "ok", "it", "ty!" ].map(s => Buffer.from(s)));
    (await asyncIter(buffered(stream, 5)).collect()).map(b => b.toString()).should.eql([ "hellok", "itty!" ]);
  });

  it("slices exactly when asked", async () => {
    const stream = asyncIter([ "hell", "okittyhowareyou!" ].map(s => Buffer.from(s)));
    (await asyncIter(buffered(stream, 5, true)).collect()).map(b => b.toString()).should.eql([
      "hello", "kitty", "howar", "eyou!"
    ]);
  });
});
