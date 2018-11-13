import { Decorate, PushAsyncIterator, Stream } from "ballvalve";
import { Crc32 } from "./crc32";
import { debug, named } from "./debug";
import { framed, unframed } from "./framed";
import { Header } from "./header";
import { Readable } from "./readable";

export const MAGIC = Buffer.from([ 0xf0, 0x9f, 0x8d, 0xbc ]);
export const VERSION = 0x00;

let counter = 0;


export enum BottleType {
  File = 0,
  Hashed = 1,
  Encrypted = 3,
  Compressed = 4,
}


export class Bottle {
  static write(type: BottleType, header: Header, streams: AsyncIterator<Stream>): Stream {
    const id = ++counter;
    const cap = new BottleCap(type, header);

    return Decorate.asyncIterator(
      async function* (): Stream {
        yield cap.write();
        for await (const s of Decorate.asyncIterator(streams)) {
          for await (const buffer of Decorate.asyncIterator(framed(s))) yield buffer;
        }
      }(),
      () => `BottleWriter[${id}](${cap.toString()})`
    );
  }

  static async read(stream: Readable): Promise<BottleReader> {
    return new BottleReader(await BottleCap.read(stream), stream);
  }
}


export class BottleReader implements AsyncIterator<Stream> {
  private iter: AsyncIterator<Stream>;
  private id = ++counter;

  constructor(public cap: BottleCap, public readable: Readable) {
    this.iter = async function* () {
      while (true) {
        const byte = await readable.read(1);
        if (byte === undefined || byte.length < 1) {
          // we hit the end.
          return;
        }

        readable.unread(byte);
        const outStream = Decorate.asyncIterator(unframed(readable));
        yield outStream;
        await outStream.onEnd();
      }
    }();
  }

  next(): Promise<IteratorResult<Stream>> {
    return this.iter.next();
  }

  toString(): string {
    return `BottleReader[${this.id}](${this.cap}, ${this.readable})`;
  }
}


export class BottleCap {
  constructor(public type: BottleType, public header: Header) {
    // pass
  }

  toString(): string {
    return `Bottle(${this.type}, ${this.header})`;
  }

  write(): Buffer {
    if (this.type < 0 || this.type > 15) throw new Error(`Bottle type out of range: ${this.type}`);
    const buffer = this.header.pack();
    if (buffer.length > 4095) throw new Error(`Header too long: ${buffer.length} > 4095`);

    const cap = Buffer.concat([
      MAGIC,
      Buffer.from([
        VERSION,
        0,
        (buffer.length & 0xff),
        (this.type << 4) | ((buffer.length >> 8) & 0xf),
      ]),
      buffer
    ]);

    return Buffer.concat([ cap, Crc32.lsbFrom(cap) ]);
  }

  static async read(stream: Readable): Promise<BottleCap> {
    const crc = new Crc32();

    const b = await stream.read(8);
    if (b === undefined || b.length < 8) throw new Error("End of stream");
    if (!b.slice(0, 4).equals(MAGIC)) throw new Error("Incorrect magic (not a bitbottle)");
    crc.update(b);

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
      crc.update(b2);
    }

    const encodedCrc = await stream.read(4);
    if (encodedCrc === undefined || encodedCrc.length < 4) throw new Error("Truncated header");
    if (encodedCrc.readUInt32LE(0) != crc.finish()) throw new Error("CRC-32 mismatch in header");
    return new BottleCap(type, header);
  }
}
