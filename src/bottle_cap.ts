import { ByteReader } from "ballvalve";
import { Crc32 } from "./crc32";
import { Header } from "./header";

export const MAGIC = Buffer.from("f09f8dbc", "hex");
export const VERSION = 0x00;

export enum BottleType {
  File = 0,
  Hashed = 1,
  Encrypted = 3,
  Compressed = 4,
}

/*
 * metadata for a bit bottle:
 *   - u32 magic (f09f8dbc)
 *   - u8 version (0)
 *   - u8 type
 *   - u16 header length
 *   - u8[...] header
 *   - u32 crc of the above
 */
export class BottleCap {
  constructor(public type: BottleType, public header: Header) {
    // pass
  }

  toString(): string {
    return `Bottle(${this.type}, ${this.header})`;
  }

  write(): Buffer {
    if (this.type < 0 || this.type > 15) throw new Error(`Bottle type out of range: ${this.type}`);
    const headerLength = this.header.byteLength();
    const cap = Buffer.alloc(headerLength + 12);
    MAGIC.copy(cap, 0);
    cap[4] = VERSION;
    cap[5] = this.type;
    cap.writeUInt16LE(headerLength, 6);
    this.header.packInto(cap, 8);
    const crc = Crc32.from(cap, 0, headerLength + 8);
    cap.writeUInt32LE(crc, headerLength + 8);
    return cap;
  }

  static async read(stream: ByteReader): Promise<BottleCap> {
    const crc = new Crc32();

    const b = await stream.read(8);
    if (b === undefined || b.length < 8) throw new Error("End of stream");
    if (!b.slice(0, 4).equals(MAGIC)) throw new Error("Incorrect magic (not a bitbottle)");
    crc.update(b);

    const version = b[4];
    const type = b[5];
    const headerLength = b.readUInt16LE(6);
    if ((version >> 4) > 0) throw new Error(`Incompatible version: ${version >> 4}.${version & 0xf}`);

    let header = new Header();
    if (headerLength > 0) {
      const b2 = await stream.read(headerLength);
      if (b2 === undefined || b2.length < headerLength) throw new Error("Truncated header");
      header = Header.unpack(b2);
      crc.update(b2);
    }

    const realCrc = crc.finish();
    const crcBuffer = await stream.read(4);
    if (crcBuffer === undefined || crcBuffer.length < 4) throw new Error("Truncated header");
    const encodedCrc = crcBuffer.readUInt32LE(0);
    if (encodedCrc != realCrc) {
      throw new Error(`CRC-32 mismatch in header (${encodedCrc.toString(16)} != ${realCrc.toString(16)})`);
    }
    return new BottleCap(type, header);
  }
}
