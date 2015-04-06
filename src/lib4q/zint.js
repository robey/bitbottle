"use strict";

const util = require("util");

function encodePackedInt(number) {
  if (number < 0) throw new Error("Unsigned ints only, plz");
  const bytes = [];
  while (number > 0xff) {
    bytes.push(number & 0xff);
    // don't use >> here. js will truncate the number to a 32-bit int.
    number /= 256;
  }
  bytes.push(number & 0xff);
  return new Buffer(bytes);
}

function decodePackedInt(buffer) {
  let rv = 0;
  let multiplier = 1;

  for (let i = 0; i < buffer.length; i++) {
    rv += (buffer[i] & 0xff) * multiplier;
    multiplier *= 256;
  }
  return rv;
}


exports.decodePackedInt = decodePackedInt;
exports.encodePackedInt = encodePackedInt;
