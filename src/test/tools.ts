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

// export function readBottle(data: Buffer): Promise<Bottle> {
//   return Bottle.read(byteReader([ data ]));
// }

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
