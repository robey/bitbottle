import { byteReader, asyncIter } from "ballvalve";
import * as snappy from "snappy";
import * as xz from "xz";
import { asyncOne } from "./async";
import { Bottle } from "./bottle";
import { BottleCap, BottleType } from "./bottle_cap";
import { framed, unframed } from "./framed";
import { Header } from "./header";

const LZMA2_PRESET = 9;

export enum Compression {
  LZMA2 = 0,
  SNAPPY = 1,
}

enum Field {
  IntCompressionType = 0,
  IntBlockSizeBits = 1,
}

export interface CompressionOptions {
  compression?: Compression;

  // how many bytes to pack into each block, with snappy
  snappyBlockSize?: number;
}

export interface UncompressedBottle {
  method: Compression;
  bottle: Bottle;
}

// (power of 2) we have to buffer this much data, so don't go crazy here.
const MIN_BLOCK_SIZE = 16 * 1024;  // 16KB
const DEFAULT_BLOCK_SIZE = 64 * 1024;  // 64KB
const MAX_BLOCK_SIZE = 1024 * 1024;  // 1MB


// blockSize only matters for snappy
export async function writeCompressedBottle(
  bottle: AsyncIterator<Buffer>,
  options: CompressionOptions = {}
): Promise<Bottle> {
  const method = options.compression ?? Compression.SNAPPY;
  let blockSize = options.snappyBlockSize ?? DEFAULT_BLOCK_SIZE;
  if (blockSize < MIN_BLOCK_SIZE || blockSize > MAX_BLOCK_SIZE) {
    throw new Error("Invalid block size");
  }
  const blockSizeBits = Math.round(Math.log2(blockSize));
  blockSize = Math.pow(2, blockSizeBits);

  const header = new Header();
  header.addInt(Field.IntCompressionType, method);
  if (method == Compression.SNAPPY) header.addInt(Field.IntBlockSizeBits, blockSizeBits);
  const cap = new BottleCap(BottleType.COMPRESSED, header);

  let compressedStream: AsyncIterator<Buffer>;

  switch (method) {
    case Compression.LZMA2:
      compressedStream = compressLzma2(bottle);
      break;

    case Compression.SNAPPY:
      compressedStream = compressSnappy(bottle, blockSize);
      break;

    default:
      throw new Error("Unknown compression");
  }

  return new Bottle(cap, asyncOne(compressedStream));
}

export async function readCompressedBottle(bottle: Bottle): Promise<UncompressedBottle> {
  if (bottle.cap.type != BottleType.COMPRESSED) throw new Error("Not a compressed bottle");
  const method: Compression = bottle.cap.header.getInt(Field.IntCompressionType) ?? Compression.SNAPPY;
  const blockSize = Math.pow(2, bottle.cap.header.getInt(Field.IntBlockSizeBits) ?? 16);
  const compressedStream = await bottle.nextDataStream();
  let stream: AsyncIterator<Buffer>;

  switch (method) {
    case Compression.LZMA2:
      stream = uncompressLzma2(compressedStream);
      break;

    case Compression.SNAPPY:
      stream = uncompressSnappy(compressedStream, blockSize);
      break;

    default:
      throw new Error("Unknown compression");
  }

  return { method, bottle: await Bottle.read(byteReader(stream)) };
}

async function* compressLzma2(stream: AsyncIterator<Buffer>): AsyncIterator<Buffer> {
  const compressor = new xz.Compressor({ preset: LZMA2_PRESET });
  for await (const b of asyncIter(stream)) yield compressor.updatePromise(b);
  yield compressor.finalPromise();
}

async function* uncompressLzma2(stream: AsyncIterator<Buffer>): AsyncIterator<Buffer> {
  const decompressor = new xz.Decompressor();
  for await (const b of asyncIter(stream)) yield decompressor.updatePromise(b);
  yield decompressor.finalPromise();
}

async function* compressSnappy(stream: AsyncIterator<Buffer>, blockSize: number): AsyncIterator<Buffer> {
  const reader = byteReader(stream);

  while (true) {
    const buffer = await reader.read(blockSize);
    if (buffer === undefined) return;
    // must frame, because snappy needs exact frames
    const compressed = snappy.compressSync(buffer);
    const compressedFramed = Buffer.concat(await asyncIter(framed(asyncOne(compressed))).collect());
    yield compressedFramed;
  }
}

async function* uncompressSnappy(stream: AsyncIterator<Buffer>, blockSize: number): AsyncIterator<Buffer> {
  const reader = byteReader(stream);

  while (true) {
    let chunk: Buffer;
    try {
      chunk = Buffer.concat(await unframed(reader).collect());
    } catch (error) {
      // end of stream
      return;
    }
    yield snappy.uncompressSync(chunk, { asBuffer: true }) as Buffer;
  }
}
