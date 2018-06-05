import { ExtendedAsyncIterator, Stream } from "ballvalve";

/*
 * wrap a `Stream` so discrete `read(N)` calls will work.
 */
export class Readable implements Stream, AsyncIterator<Buffer> {
  saved: Buffer[] = [];
  size = 0;
  ended = false;
  iter: AsyncIterator<Buffer>;
  done: Promise<void>;

  constructor(public stream: ExtendedAsyncIterator<Buffer>) {
    this.iter = stream[Symbol.asyncIterator]();
    this.done = stream.done;
  }

  private async fillTo(size: number): Promise<void> {
    if (this.ended) return;

    while (this.size < size) {
      const item = await this.iter.next();
      if (item.done) {
        this.ended = true;
        return;
      }
      this.saved.push(item.value);
      this.size += item.value.length;
    }
  }

  async read(size: number): Promise<Buffer | undefined> {
    await this.fillTo(size);
    if (this.saved.length == 0) return undefined;

    // this works even if size > this.size
    const total = Buffer.concat(this.saved);
    const rv = total.slice(0, size);
    if (size == total.length) {
      this.saved = [];
      this.size = 0;
    } else {
      this.saved = [ total.slice(size) ];
      this.size = this.saved[0].length;
    }
    return rv;
  }

  unread(b: Buffer) {
    this.saved.unshift(b);
    this.size += b.length;
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  async next(): Promise<IteratorResult<Buffer>> {
    const b = this.saved.shift();
    if (b !== undefined) {
      this.size -= b.length;
      return { done: false, value: b };
    }
    const rv = await this.iter.next();
    if (rv.done) this.ended = true;
    return rv;
  }

  remainder(): Buffer | undefined {
    if (this.size == 0) return undefined;
    const rv = Buffer.concat(this.saved);
    this.saved = [];
    this.size = 0;
    return rv;
  }

  toString(): string {
    return `Readable(${this.stream})`;
  }
}
