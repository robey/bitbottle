"use strict";

import * as zint from "./zint";

export const TYPE_STRING = 0;
export const TYPE_ZINT = 2;
export const TYPE_BOOL = 3;

export class Header {
  constructor() {
    this.fields = [];
  }

  addBool(id) {
    this.fields.push({ type: TYPE_BOOL, id, content: new Buffer(0) });
    return this;
  }

  addNumber(id, number) {
    this.fields.push({ type: TYPE_ZINT, id, content: zint.encodePackedInt(number), number });
    return this;
  }

  addString(id, str) {
    this.addStringList(id, [ str ]);
    return this;
  }

  addStringList(id, list) {
    const buffers = list.slice(0, list.length - 1).map((str) => new Buffer(str + "\x00", "UTF-8"));
    buffers.push(new Buffer(list[list.length - 1], "UTF-8"));
    this.fields.push({ type: TYPE_STRING, id, content: Buffer.concat(buffers), list });
    return this;
  }

  pack() {
    // each header item has a 16-bit prefix: TTDDDDLL LLLLLLLL (T = type, D = id#, L = length)
    const buffers = [];
    this.fields.forEach((f) => {
      if (f.id > 15 || f.id < 0) throw new Error(`Header ID out of range: ${f.id}`);
      if (f.content.length > 1023) throw new Error(`Header ${id} too large (${f.content.length}, max 1023)`);
      buffers.push(new Buffer([
        (f.type << 6) | (f.id << 2) | ((f.content.length >> 8) & 0x2),
        (f.content.length & 0xff)
      ]));
      buffers.push(f.content);
    });
    return buffers;
  }

  toString() {
    const strings = this.fields.map((f) => {
      switch (f.type) {
        case TYPE_BOOL: return `B${f.id}`;
        case TYPE_ZINT: return `I${f.id}=${f.number}`;
        case TYPE_STRING: return `S${f.id}=${util.inspect(f.list)}`;
      }
    });
    return "Header(" + strings.join(", ") + ")";
  }
}


export function unpack(buffer) {
  const header = new Header();
  let i = 0;
  while (i < buffer.length) {
    if (i + 2 > buffer.length) throw new Error("Truncated header");
    const type = (buffer[i] & 0xc0) >> 6;
    const id = (buffer[i] & 0x3c) >> 2;
    const length = (buffer[i] & 0x3) * 256 + (buffer[i + 1] & 0xff);
    i += 2;
    if (i + length > buffer.length) throw new Error("Truncated header");
    const content = buffer.slice(i, i + length);
    const field = { type, id };
    switch (type) {
      case TYPE_ZINT:
        field.number = zint.decodePackedInt(content);
        break;
      case TYPE_STRING:
        field.string = content.toString("UTF-8");
        field.list = field.string.split("\x00");
    }
    header.fields.push(field);
    i += length;
  }
  return header;
}
