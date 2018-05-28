import * as stream from "stream";
import { asyncIter, PushAsyncIterator } from "ballvalve";
import { debug, named } from "./debug";
import { framed } from "./framed";
import { Header } from "./header";
import { AsyncIterableSequence, Stream, TerminationSignal } from "./streams";


export function writable(): [ stream.Writable, AsyncIterable<Buffer> ] {
  const pusher = new PushAsyncIterator<Buffer>();
  const transform = new stream.Transform({
    transform(chunk, _encoding, callback) {
      pusher.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      callback();
    },

    flush(callback) {
      pusher.end();
      callback();
    }
  });
  return [ transform, pusher ];
}


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

let counter = 0;

export class BottleWriter {
  private sequence = new AsyncIterableSequence<Buffer>();

  // output stream:
  stream: Stream;

  constructor(type: BottleType, header: Header) {
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

    counter++;
    this.stream = named(this.sequence.stream, `BottleWriter(${counter})`);
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
