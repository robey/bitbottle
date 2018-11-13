import { AsyncIterableOnce, Decorate, Stream } from "ballvalve";

/*
 * wrap a `Stream` so discrete `read(N)` calls will work.
 */
export class Readable {
  saved: Buffer[] = [];
  size = 0;
  ended = false;
  iter: AsyncIterableOnce<Buffer>;

  constructor(public stream: Stream) {
    this.iter = Decorate.asyncIterator(stream);
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

  remainder(): Buffer | undefined {
    if (this.size == 0) return undefined;
    const rv = Buffer.concat(this.saved);
    this.saved = [];
    this.size = 0;
    return rv;
  }

  toString(): string {
    const unread = (Buffer.concat(this.saved) as any).inspect();
    return `Readable(${this.stream}, buffered=${unread})`;
  }
}
