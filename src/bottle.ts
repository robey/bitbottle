import { asyncIter } from "ballvalve";
import { BottleCap } from "./bottle_cap";
import { framed } from "./framed";

// frame headers 40, 80, c0 are reserved, so use them for out-of-band signalling.
const STREAM_RAW = 0x40;
const STREAM_BOTTLE = 0x80;
const STREAM_END = 0xc0;

let counter = 0;


export class Bottle {
  constructor(public cap: BottleCap, public streams: AsyncIterable<AsyncIterable<Buffer> | Bottle>) {
    // pass
  }

  write(): AsyncIterable<Buffer> {
    const id = ++counter;
    const self = this;

    return asyncIter(
      async function* (): AsyncIterable<Buffer> {
        yield self.cap.write();
        for await (const s of self.streams) {
          if (s instanceof Bottle) {
            yield Buffer.from([ STREAM_BOTTLE ]);
            yield* s.write();
          } else {
            // raw stream
            yield Buffer.from([ STREAM_RAW ]);
            yield* framed(s);
          }
        }
        yield Buffer.from([ STREAM_END ]);
      }(),
      () => `BottleWriter[${id}](${self.cap.toString()})`
    );
  }

}
