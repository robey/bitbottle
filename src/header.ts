import * as bigInt from "big-integer";

/*
 * the header is up to 1KB of fields. each field is a 1 byte descriptor
 * followed by content. the high nybble of the descriptor is the type, and
 * the low nybble is the id (distinct per type).
 *
 * types:
 *   - 0: boolean/flag, len=0
 *   - 1: u8, len=1
 *   - 2: u16, len=2
 *   - 3: u32, len=4
 *   - 4: u64, len=8
 *   - 5: utf-8 string, len byte follows
 */

// let's not get carried away, kids
const MAX_HEADER_BYTES = 1023;

export enum Type {
  FLAG = 0,
  U8 = 1,
  U16 = 2,
  U32 = 3,
  U64 = 4,
  STRING = 5,
}

const Lengths: { [key: number]: number } = {
  [Type.FLAG]: 0,
  [Type.U8]: 1,
  [Type.U16]: 2,
  [Type.U32]: 4,
  [Type.U64]: 8,
  [Type.STRING]: 1,
}

const MASK_32 = bigInt("ffffffff", 16);

export class Field {
  rawStr?: Buffer;

  constructor(
    public type: Type,
    public id: number,
    public int?: number,
    public str?: string,
    public bigint?: bigInt.BigInteger
  ) {
    if (str) this.rawStr = Buffer.from(str);
  }

  toString(): string {
    switch (this.type) {
      case Type.FLAG:
        return `F(${this.id})`;
      case Type.U8:
        return `U8(${this.id})=${this.int}`;
      case Type.U16:
        return `U16(${this.id})=${this.int}`;
      case Type.U32:
        return `U32(${this.id})=${this.int}`;
      case Type.U64:
        return `U64(${this.id})=${this.bigint}`;
      case Type.STRING:
        return `S(${this.id})="${this.str}"`;
      default:
        console.log(this.type);
        return "?";
    }
  }
}

export class Header {
  fields: Field[] = [];

  addFlag(id: number): this {
    this.fields.push(new Field(Type.FLAG, id));
    return this;
  }

  addU8(id: number, int: number): this {
    this.fields.push(new Field(Type.U8, id, int));
    return this;
  }

  addU16(id: number, int: number): this {
    this.fields.push(new Field(Type.U16, id, int));
    return this;
  }

  addU32(id: number, int: number): this {
    this.fields.push(new Field(Type.U32, id, int));
    return this;
  }

  addU64(id: number, bigint: bigInt.BigInteger): this {
    this.fields.push(new Field(Type.U64, id, undefined, undefined, bigint));
    return this;
  }

  addString(id: number, str: string): this {
    this.fields.push(new Field(Type.STRING, id, undefined, str));
    return this;
  }

  getFlag(id: number): boolean {
    return this.fields.find(f => f.type == Type.FLAG && f.id == id) !== undefined;
  }

  getU8(id: number): number | undefined {
    return this.fields.find(f => f.type == Type.U8 && f.id == id)?.int;
  }

  getU16(id: number): number | undefined {
    return this.fields.find(f => f.type == Type.U16 && f.id == id)?.int;
  }

  getU32(id: number): number | undefined {
    return this.fields.find(f => f.type == Type.U32 && f.id == id)?.int;
  }

  getU64(id: number): bigInt.BigInteger | undefined {
    return this.fields.find(f => f.type == Type.U64 && f.id == id)?.bigint;
  }

  getString(id: number): string | undefined {
    return this.fields.find(f => f.type == Type.STRING && f.id == id)?.str;
  }

  toString(): string {
    return "Header(" + this.fields.map(f => f.toString()).join(", ") + ")";
  }

  byteLength(): number {
    return this.fields.reduce((sum, f) => sum + 1 + Lengths[f.type] + (f.rawStr?.length ?? 0), 0);
  }

  packInto(buffer: Buffer, offset: number) {
    const bufferLen = this.byteLength();
    if (bufferLen > MAX_HEADER_BYTES) throw new Error(`Header too large (${bufferLen} > ${MAX_HEADER_BYTES})`);
    if (buffer.length < offset + bufferLen) throw new Error("Buffer isn't big enough");

    let n = offset;
    for (const f of this.fields) {
      if (f.id > 15 || f.id < 0) throw new Error(`Header ID out of range: ${f.id}`);
      buffer[n++] = ((f.type & 15) << 4) | f.id;

      switch (f.type) {
        case Type.FLAG:
          break;
        case Type.U8:
          buffer.writeUInt8(f.int || 0, n);
          n += 1;
          break;
        case Type.U16:
          buffer.writeUInt16LE(f.int || 0, n);
          n += 2;
          break;
        case Type.U32:
          buffer.writeUInt32LE(f.int || 0, n);
          n += 4;
          break;
        case Type.U64:
          buffer.writeUInt32LE(f.bigint?.and(MASK_32).toJSNumber() || 0, n);
          buffer.writeUInt32LE(f.bigint?.shiftRight(32).and(MASK_32).toJSNumber() || 0, n + 4);
          n += 8;
          break;
        case Type.STRING: {
          const len = f.rawStr?.length ?? 0;
          buffer.writeUInt8(len, n);
          if (f.rawStr) f.rawStr.copy(buffer, n + 1);
          n += 1 + len;
          break;
        }
      }
    }
  }

  pack(): Buffer {
    const buffer = Buffer.alloc(this.byteLength());
    this.packInto(buffer, 0);
    return buffer;
  }

  static unpack(data: Buffer): Header {
    const header = new Header();
    let i = 0;
    while (i < data.length) {
      const type = (data[i] & 0xf0) >> 4;
      const id = data[i] & 0xf;
      const f = new Field(type, id);
      i++;

      const length = Lengths[type];
      if (i + length > data.length) throw new Error("Truncated header");
      switch (type) {
        case Type.FLAG:
          break;
        case Type.U8:
          f.int = data.readUInt8(i);
          break;
        case Type.U16:
          f.int = data.readUInt16LE(i);
          break;
        case Type.U32:
          f.int = data.readUInt32LE(i);
          break;
        case Type.U64:
          f.bigint = bigInt(data.readUInt32LE(i)).add(bigInt(data.readUInt32LE(i + 4)).shiftLeft(32));
          break;
        case Type.STRING: {
          const strlen = data.readUInt8(i);
          if (i + 1 + strlen > data.length) throw new Error("Truncated header");
          f.rawStr = data.slice(i + 1, i + 1 + strlen);
          f.str = f.rawStr.toString("utf8");
          i += strlen;
          break;
        }
      }

      header.fields.push(f);
      i += length;
    }

    return header;
  }
}
