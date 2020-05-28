// for convenience: turn an Iterable into an AsyncIterator
export async function* asyncify<A>(iter: Iterable<A>): AsyncIterator<A> {
  for (const item of iter) yield item;
}

// for convenience: turn any item into an AsyncIterator of one item
export async function *asyncOne<A>(item: A): AsyncIterator<A> {
  yield item;
}
