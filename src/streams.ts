// a Stream in async form

import { PushAsyncIterator } from "ballvalve";
import { debug, named, nameOf } from "./debug";

let counter = 0;

export type Stream = AsyncIterable<Buffer>;

export class TerminationSignal<A> {
  constructor(public stream: AsyncIterable<A>, public resolve: () => void) {
    named(this, `TerminationSignal(${nameOf(stream)})`);
  }
}

/*
 * take a stream of `AsyncIterable`s and chain them all together, calling the
 * `resolve` callback of each one as it finishes.
 */
async function* flattenWithSignal<A>(this: any, stream: AsyncIterable<TerminationSignal<A>>): AsyncIterable<A> {
  debug(`flatten(${nameOf(stream)}) begin`);
  for await (const term of stream) {
    debug(`flatten(${nameOf(stream)}) substream: ${nameOf(term)}`);
    for await (const item of term.stream) {
      if (item instanceof Buffer) debug(`flatten(${nameOf(stream)}): ${item.length}`);
      yield item;
    }
    debug(`flatten(${nameOf(stream)}) substream end`);
    term.resolve();
  }
  debug(`flatten(${nameOf(stream)}) end`);
}

/*
 * compose a single `AsyncIterable` out of several, using `PushAsyncIterator`.
 *
 * each inner stream is associated with a termination signal, so you can
 * serialize the streams, waiting for the current stream to finish before
 * adding the next.
 */
export class AsyncIterableSequence<A> {
  private pusher: PushAsyncIterator<TerminationSignal<A>>;

  stream: AsyncIterable<A>;

  // output stream:

  constructor() {
    counter++;
    this.pusher = new PushAsyncIterator<TerminationSignal<A>>();
    this.stream = flattenWithSignal(named(this.pusher, `AsyncIterableSequence(${counter})`));
  }

  // add the next stream. returns a promise that resolves when the stream is
  // drained.
  add(s: AsyncIterable<A>): Promise<void> {
    return new Promise(resolve => {
      this.pusher.push(new TerminationSignal(s, resolve));
    });
  }

  end() {
    this.pusher.end();
  }
}
