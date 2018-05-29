import { asyncIter, PushAsyncIterator } from "ballvalve";
import { debug, named } from "./debug";
import { framed, unframed } from "./framed";
import { Header } from "./header";
import { Readable } from "./readable";
import { AlertingAsyncIterator, AsyncIterableSequence, Stream, TerminationSignal } from "./streams";


let counter = 0;

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
}


export class BottleWriter {
  private sequence = new AsyncIterableSequence<Buffer>();

  // output stream:
  stream: Stream;

  constructor(bottle: Bottle) {
    counter++;
    this.stream = named(this.sequence.stream, `BottleWriter(${counter})`);
    this.writeHeader(bottle.type, bottle.header);
  }

  writeHeader(type: BottleType, header: Header) {
    if (type < 0 || type > 15) throw new Error(`Bottle type out of range: ${type}`);
    const buffer = header.pack();
    if (buffer.length > 4095) throw new Error(`Header too long: ${buffer.length} > 4095`);

    // make and push the bottle header
    const headers = asyncIter([
      MAGIC,
      new Buffer([
        VERSION,
        0,
        (buffer.length & 0xff),
        (type << 4) | ((buffer.length >> 8) & 0xf),
      ]),
      buffer
    ]);
    this.sequence.add(headers);
  }

  addStream(s: Stream): Promise<void> {
    this.sequence.add(asyncIter([ Buffer.from([ STREAM_DATA ]) ]));
    return this.sequence.add(framed(s));
  }

  addBottle(b: BottleWriter): Promise<void> {
    this.sequence.add(asyncIter([ Buffer.from([ STREAM_BOTTLE ]) ]));
    return this.sequence.add(b.stream);
  }

  end() {
    this.sequence.add(asyncIter([ Buffer.from([ STREAM_STOP ]) ]));
    this.sequence.end();
  }
}


export class BottleReader {
  private constructor(public bottle: Bottle, public nested: AlertingAsyncIterator<BottleReader | Stream>) {
    // pass
  }

  static async read(r: Readable): Promise<BottleReader> {
    return new BottleReader(await readBottleHeader(r), new AlertingAsyncIterator(readBottleStreams(r)));
  }
}


async function* readBottleStreams(stream: Readable): AsyncIterable<BottleReader | Stream> {
  while (true) {
    const byte = await stream.read(1);
    if (byte === undefined || byte.length < 1) throw new Error("Truncated stream data");
    switch (byte[0]) {
      case STREAM_DATA: {
        const s = new AlertingAsyncIterator(unframed(stream));
        yield asyncIter(s);
        await s.done;
        break;
      }
      case STREAM_BOTTLE: {
        const b = await BottleReader.read(stream);
        yield b;
        await b.nested.done;
        break;
      }
      case STREAM_STOP:
        return;
      default:
        throw new Error(`Unknown stream tag ${byte[0]}`);
    }
  }
}

async function readBottleHeader(stream: Readable): Promise<Bottle> {
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
