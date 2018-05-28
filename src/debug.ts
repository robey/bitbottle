let logger: (text: string) => void = () => null;

export function debug(text: string) {
  logger(text);
}

export function setLogger(x: (text: string) => void) {
  logger = x;
}

// hack to allow giving names to anonymous generator functions
export function named(x: any, name: string): any {
  x["__name"] = name;
  return x;
}

export function nameOf(x: any): string {
  if (x["__name"]) return x["__name"];
  if (x.constructor && x.constructor.name) return x.constructor.name;
  return "(anon)";
}
