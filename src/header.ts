import * as zint from "./zint";

const EMPTY = Buffer.from([]);

export enum Type {
  STRING = 0,
  INT = 2,
  BOOL = 3,
}

export class Field {
  int?: number;
  list?: string[];

  constructor(public type: Type, public id: number) {
    // pass
  }

  toString(): string {
    switch (this.type) {
      case Type.STRING: return `S${this.id}=${(this.list || []).join(",")}`;
      case Type.INT: return `I${this.id}=${this.int || 0}`;
      case Type.BOOL: return `B${this.id}`;
    }
  }

  static fromBool(id: number): Field {
    return new Field(Type.BOOL, id);
  }

  static fromInt(id: number, n: number): Field {
    const rv = new Field(Type.INT, id);
    rv.int = n;
    return rv;
  }

  static fromStrings(id: number, list: string[]): Field {
    const rv = new Field(Type.STRING, id);
    rv.list = list;
    return rv;
  }

  // unpack()
}

export class Header {
  fields: Field[] = [];

  addBool(id: number) {
    this.fields.push(Field.fromBool(id));
    return this;
  }

  addNumber(id: number, int: number) {
    this.fields.push(Field.fromInt(id, int));
    return this;
  }

  addString(id: number, str: string) {
    this.addStringList(id, [ str ]);
    return this;
  }

  addStringList(id: number, list: string[]) {
    this.fields.push(Field.fromStrings(id, list));
    return this;
  }

  toString(): string {
    return "Header(" + this.fields.map(f => f.toString()).join(", ") + ")";
  }

  pack(): Buffer {
    const buffers: Buffer[] = [];
    this.fields.forEach(f => {
      if (f.id > 15 || f.id < 0) throw new Error(`Header ID out of range: ${f.id}`);

      let content: Buffer = EMPTY;
      switch (f.type) {
        case Type.STRING:
          content = Buffer.from((f.list || []).join("\u0000"));
          break;
        case Type.INT:
          content = zint.encodePackedInt(f.int || 0);
          break;
        case Type.BOOL:
          break;
      }
      if (content.length > 1023) throw new Error(`Header ${f.id} too large (${content.length} > 1023)`);

      // each field has a 16-bit prefix: TTDDDDLL LLLLLLLL (T = type, D = id#, L = length)
      buffers.push(Buffer.from([
        content.length & 0xff,
        (f.type << 6) | (f.id << 2) | ((content.length >> 6) & 0x3),
      ]));
      buffers.push(content);
    });
    return Buffer.concat(buffers);
  }

  static unpack(data: Buffer): Header {
    const header = new Header();
    let i = 0;
    while (i < data.length) {
      if (i + 2 > data.length) throw new Error("Truncated header");
      const type = (data[i + 1] & 0xc0) >> 6;
      const id = (data[i + 1] & 0x3c) >> 2;
      const length = (data[i] & 0xff) + (data[i + 1] & 0x3) * 256;
      i += 2;

      const f = new Field(type, id);
      if (i + length > data.length) throw new Error("Truncated header");
      const content = data.slice(i, i + length);
      switch (type) {
        case Type.INT:
          f.int = zint.decodePackedInt(content);
          break;
        case Type.STRING:
          f.list = content.toString("UTF-8").split("\u0000");
          break;
      }

      header.fields.push(f);
      i += length;
    }

    return header;
  }
}
