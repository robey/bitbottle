import { Crc32 } from "../crc32";

import "should";
import "source-map-support/register";

describe("crc32", () => {
  it("works", async () => {
    Crc32.from(Buffer.from([])).should.eql(0);
    Crc32.from(Buffer.from("123456789")).should.eql(0xcbf43926);
    Crc32.from(Buffer.from("hello sailor")).should.eql(0xb19b3701);
  });
});
