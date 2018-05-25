/*
 * wrap an `AsyncIterator<Buffer>` so discrete `read(N)` calls will work.
 */
export class Readable {
  saved: Buffer[] = [];
  size = 0;
  ended = false;

  constructor(public stream: AsyncIterator<Buffer>) {
    // pass
  }

  private async fillTo(size: number): Promise<void> {
    if (this.ended) return;

    while (this.size < size) {
      const item = await this.stream.next();
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
    this.saved = [ total.slice(size) ];
    this.size = this.saved[0].length;
    return rv;
  }
}
