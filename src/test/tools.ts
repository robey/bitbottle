import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { asyncIter } from "ballvalve";
import { asyncify } from "../async";


export function delay(msec: number) {
  return new Promise<void>(resolve => setTimeout(resolve, msec));
}

export async function drain(s: AsyncIterator<Buffer>): Promise<Buffer> {
  return Buffer.concat(await asyncIter(s).collect());
}

export async function hex(s: AsyncIterator<Buffer>): Promise<string> {
  return (await drain(s)).toString("hex");
}

export function fromHex(hex: string): AsyncIterator<Buffer> {
  return asyncify([ Buffer.from(hex, "hex") ]);
}

export async function* asyncSegments(data: Buffer, size: number): AsyncIterator<Buffer> {
  while (data.length > 0) {
    if (data.length <= size) {
      yield data;
      return;
    }
    const chunk = data.slice(0, size);
    data = data.slice(size);
    yield chunk;
  }
}

export function makeTempFolder(): string {
  let uniq: string;
  let tries = 0;
  while (true) {
    tries += 1;
    uniq = path.join(os.tmpdir(), `mocha-test-${crypto.pseudoRandomBytes(16).toString("hex")}`);
    try {
      fs.mkdirSync(uniq, 7 << 6);
      break;
    } catch (error) {
      if (tries >= 5) throw new Error(`Unable to create temporary folder: ${error.message}`);
      // try again with a different folder name
    }
  }

  process.on("exit", () => rmdirAll(uniq));
  return uniq;
}

function rmdirAll(root_path: string) {
  for (const filename of fs.readdirSync(root_path)) {
    const full_name = path.join(root_path, filename);
    if (fs.lstatSync(full_name).isDirectory()) {
      rmdirAll(full_name);
    } else {
      fs.chmodSync(full_name, 6 << 6);
      fs.unlinkSync(full_name);
    }
  }

  fs.chmodSync(root_path, 7 << 6);
  fs.rmdirSync(root_path);
}


// make a bunch of text-looking bytes that have a high chance of being snappy-friendly
export function prngBytes(count: number): Buffer {
  let seed = 1337;
  const randFloat = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const rand = (max: number) => Math.floor(randFloat() * max);

  const words: string[] = [];

  while (count > 0) {
    if (words.length > 10 && rand(100) < 20) {
      // 20% chance of repeating a word
      const n = rand(Math.min(words.length, 100));
      const word = words[words.length - n - 1];
      words.push(word);
      count -= word.length;
    } else {
      const len = 3 + rand(11);
      const word = [...Array(len).keys()].map(_ => String.fromCodePoint(0x61 + rand(26))).join("");
      words.push(word);
      count -= len;
    }
  }

  return Buffer.from(words.join(" ")).slice(0, count);
}
