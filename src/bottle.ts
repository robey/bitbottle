import { AlertingAsyncIterator, asyncIter, PushAsyncIterator, Stream } from "ballvalve";
import { debug, named } from "./debug";
import { framed, unframed } from "./framed";
import { Header } from "./header";
import { Readable } from "./readable";

export const MAGIC = new Buffer([ 0xf0, 0x9f, 0x8d, 0xbc ]);
export const VERSION = 0x00;

const STREAM_DATA = 0xed;
const STREAM_BOTTLE = 0xee;
const STREAM_STOP = 0xef;


export enum BottleType {
  File = 0,
  Hashed = 1,
  Encrypted = 3,
  Compressed = 4,
}


export class Bottle {
  constructor(public type: BottleType, public header: Header) {
    // pass
  }

  write(): BottleWriter {
    if (this.type < 0 || this.type > 15) throw new Error(`Bottle type out of range: ${this.type}`);
    const buffer = this.header.pack();
    if (buffer.length > 4095) throw new Error(`Header too long: ${buffer.length} > 4095`);

    // make and push the bottle header
    const headers = asyncIter([
      MAGIC,
      new Buffer([
        VERSION,
        0,
        (buffer.length & 0xff),
        (this.type << 4) | ((buffer.length >> 8) & 0xf),
      ]),
      buffer
    ]);

    const writer = new BottleWriter();
    writer.pusher.push(headers);
    return writer;
  }

  static async read(stream: Readable): Promise<BottleReader> {
    const b = await Bottle.readHeaderFrom(stream);
    return new BottleReader(b, stream);
  }

  static async readHeaderFrom(stream: Readable): Promise<Bottle> {
    const b = await stream.read(8);
    if (b === undefined || b.length < 8) throw new Error("End of stream");
    if (!b.slice(0, 4).equals(MAGIC)) throw new Error("Incorrect magic (not a bitbottle)");

    const version = b[4];
    const flags = b[5];
    const headerLength = b[6] + (b[7] & 0xf) * 256;
    const type = b[7] >> 4;
    if ((version >> 4) > 0) throw new Error(`Incompatible version: ${version >> 4}.${version & 0xf}`);
    if (flags != 0) throw new Error(`Garbage flags`);

    let header = new Header();
    if (headerLength > 0) {
      const b2 = await stream.read(headerLength);
      if (b2 === undefined || b2.length < headerLength) throw new Error("Truncated header");
      header = Header.unpack(b2);
    }

    return new Bottle(type, header);
  }
}


export class BottleWriter implements Stream {
  pusher = new PushAsyncIterator<Stream>();

  constructor() {
    // pass
  }

  // flatten
  [Symbol.asyncIterator]() {
    const pusher = this.pusher;
    return async function* () {
      for await (const stream of pusher) {
        for await (const item of stream) yield item;
      }
    }();
  }

  addStream(s: Stream): Promise<void> {
    this.pusher.push(asyncIter([ Buffer.from([ STREAM_DATA ]) ]));
    const stream = asyncIter(framed(s)).alerting();
    this.pusher.push(stream);
    return stream.done;
  }

  addBottle(b: BottleWriter): Promise<void> {
    this.pusher.push(asyncIter([ Buffer.from([ STREAM_BOTTLE ]) ]));
    const stream = asyncIter(b).alerting();
    this.pusher.push(stream);
    return stream.done;
  }

  end() {
    this.pusher.push(asyncIter([ Buffer.from([ STREAM_STOP ]) ]));
    this.pusher.end();
  }
}


export class BottleReader implements AsyncIterator<BottleReader | Stream>, AsyncIterable<BottleReader | Stream> {
  done: Promise<void>;
  private iter: AlertingAsyncIterator<BottleReader | Stream>;

  constructor(public bottle: Bottle, public stream: Readable) {
    this.iter = asyncIter(async function* () {
      while (true) {
        const byte = await stream.read(1);
        if (byte === undefined || byte.length < 1) throw new Error("Truncated stream data");

        switch (byte[0]) {
          case STREAM_DATA: {
            const s = asyncIter(unframed(stream)).alerting();
            yield s;
            await s.done;
            break;
          }
          case STREAM_BOTTLE: {
            const b = await Bottle.read(stream);
            yield b;
            await b.done;
            break;
          }
          case STREAM_STOP:
            return;
          default:
            throw new Error(`Unknown stream tag ${byte[0]}`);
        }
      }
    }()).alerting();
    this.done = this.iter.done;
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next(): Promise<IteratorResult<BottleReader | Stream>> {
    return this.iter.next();
  }
}
