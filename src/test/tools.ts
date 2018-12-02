import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Decorate, Stream } from "ballvalve";
import { Bottle } from "../bottle";
import { Readable } from "../readable";

export function delay(msec: number) {
  return new Promise<void>(resolve => setTimeout(resolve, msec));
}

export async function drain(s: Stream): Promise<Buffer> {
  return Buffer.concat(await Decorate.asyncIterator(s).collect());
}

export async function hex(s: Stream): Promise<string> {
  return (await drain(s)).toString("hex");
}

export function readBottle(data: Buffer): Promise<Bottle> {
  return Bottle.read(new Readable(Decorate.iterator([ data ])));
}

export function makeTempFolder(): string {
  let uniq: string;
  let tries = 0;
  while (true) {
    tries += 1;
    uniq = path.join(os.tmpdir(), `mocha-testfolder-${crypto.pseudoRandomBytes(16).toString("hex")}`);
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

function rmdirAll(rootpath: string) {
  for (const filename of fs.readdirSync(rootpath)) {
    const fullname = path.join(rootpath, filename);
    if (fs.lstatSync(fullname).isDirectory()) {
      rmdirAll(fullname);
    } else {
      fs.chmodSync(fullname, 6 << 6);
      fs.unlinkSync(fullname);
    }
  }

  fs.chmodSync(rootpath, 7 << 6);
  fs.rmdirSync(rootpath);
}
