import { Decorate, Stream } from "ballvalve";
import * as snappy from "snappy";
import { Compressor, Decompressor, ENCODE_FINISH } from "xz";
import { Bottle, BottleType } from "./bottle";
import { Header } from "./header";

export enum Compression {
  LZMA2 = 0,
  SNAPPY = 1,
  // for decoding:
  MIN = 0,
  MAX = 1,
}

const NAME = {
  [Compression.LZMA2]: "LZMA2",
  [Compression.SNAPPY]: "Snappy"
};

enum Field {
  IntCompressionType = 0,
}

const LZMA2_PRESET = 9;


export class CompressedBottle {
  private constructor(public bottle: Bottle, public stream: Stream) {
    // pass
  }

  static write(type: Compression, stream: Stream): Stream {
    const header = new Header();
    header.addInt(Field.IntCompressionType, type);

    let compressedStream: Stream;
    switch (type) {
      case Compression.LZMA2:
        compressedStream = new LzmaCompressor(stream);
        break;
      case Compression.SNAPPY:
        compressedStream = new SnappyCompressor(stream);
        break;
      default:
        throw new Error("Unknown compression");
    }

    return Bottle.write(BottleType.Compressed, header, Decorate.iterator([ compressedStream ]));
  }

  static async read(bottle: Bottle): Promise<CompressedBottle> {
    const type: Compression = bottle.cap.header.getInt(Field.IntCompressionType) || 0;
    if (type < Compression.MIN || type > Compression.MAX) throw new Error(`Unknown compression type ${type}`);
    const stream = await bottle.nextStream();

    let decompressedStream: Stream;
    switch (type) {
      case Compression.LZMA2:
        decompressedStream = new LzmaDecompressor(stream);
        break;
      case Compression.SNAPPY:
        decompressedStream = new SnappyDecompressor(stream);
        break;
      default:
        throw new Error("Unknown compression");
    }

    return new CompressedBottle(bottle, decompressedStream);
  }
}

class SnappyCompressor implements Stream {
  constructor(public wrapped: Stream) {
    // pass
  }

  async next(): Promise<IteratorResult<Buffer>> {
    const item = await this.wrapped.next();
    if (item.done || item.value === undefined) return item;
    return { done: false, value: snappy.compressSync(item.value) };
  }
}

class SnappyDecompressor implements Stream {
  constructor(public wrapped: Stream) {
    // pass
  }

  async next(): Promise<IteratorResult<Buffer>> {
    const item = await this.wrapped.next();
    if (item.done || item.value === undefined) return item;
    return { done: false, value: snappy.uncompressSync(item.value) };
  }
}

class LzmaCompressor implements Stream {
  lzma = new Compressor({ preset: LZMA2_PRESET });
  finished = false;

  constructor(public wrapped: Stream) {
    // pass
  }

  async next(): Promise<IteratorResult<Buffer>> {
    if (this.finished) return { done: true } as IteratorResult<Buffer>;
    const item = await this.wrapped.next();
    if (item.done || item.value === undefined) {
      this.finished = true;
      return { done: false, value: this.lzma.process(undefined, ENCODE_FINISH) };
    }
    return { done: false, value: this.lzma.process(item.value) };
  }
}

class LzmaDecompressor implements Stream {
  lzma = new Decompressor();
  finished = false;

  constructor(public wrapped: Stream) {
    // pass
  }

  async next(): Promise<IteratorResult<Buffer>> {
    if (this.finished) return { done: true } as IteratorResult<Buffer>;
    const item = await this.wrapped.next();
    if (item.done || item.value === undefined) {
      this.finished = true;
      return { done: false, value: this.lzma.process(undefined, ENCODE_FINISH) };
    }
    return { done: false, value: this.lzma.process(item.value) };
  }
}
