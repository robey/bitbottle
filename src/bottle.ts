import { asyncIter, ByteReader } from "ballvalve";
import { BottleCap } from "./bottle_cap";
import { framed, unframed } from "./framed";

// frame headers 40, 80, c0 are reserved, so use them for out-of-band signalling.
const STREAM_RAW = 0x40;
const STREAM_BOTTLE = 0x80;
const STREAM_END = 0xc0;

let counter = 0;


export class Bottle {
  constructor(public cap: BottleCap, public streams: AsyncIterator<AsyncIterator<Buffer> | Bottle>) {
    // pass
  }

  async nextStream(): Promise<AsyncIterator<Buffer> | Bottle | undefined> {
    const item = await this.streams.next();
    if (item.done) return undefined;
    return item.value;
  }

  write(): AsyncIterator<Buffer> {
    const id = ++counter;
    const self = this;

    return async function* (): AsyncIterator<Buffer> {
      yield self.cap.write();
      for await (const s of asyncIter(self.streams)) {
        if (s instanceof Bottle) {
          yield Buffer.from([ STREAM_BOTTLE ]);
          yield* asyncIter(s.write());
        } else {
          // raw stream
          yield Buffer.from([ STREAM_RAW ]);
          yield* asyncIter(framed(s));
        }
      }
      yield Buffer.from([ STREAM_END ]);
    }();
  }

  static async read(stream: ByteReader): Promise<Bottle> {
    const id = ++counter;
    const cap = await BottleCap.read(stream);

    const streams = asyncIter(async function* () {
      while (true) {
        const marker = await stream.read(1);
        if (marker === undefined || marker.length < 1) throw new Error("Truncated bottle");
        switch (marker[0]) {
          case STREAM_RAW: {
            // need to wait for the stream to finish before reading the next one
            const inner = asyncIter(unframed(stream)).alerting();
            const done = inner.done;
            yield inner;
            await done;
            break;
          }
          case STREAM_BOTTLE: {
            const inner = Bottle.read(stream);
            // FIXME
            yield inner;
            break;
          }
          case STREAM_END:
            return;
          default:
            throw new Error(`Stray byte 0x${marker[0].toString(16)} at position ${stream.bytesRead}`);
        }
      }
    }(), () => `BottleReader[${id}](${cap}, ${stream})`);

    return new Bottle(cap, streams[Symbol.asyncIterator]());
  }

}
