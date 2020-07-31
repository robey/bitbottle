// groan. the "posix" module hasn't been updated since 2016, and has no @types file yet.
declare module "posix" {
  export function getpwnam(uid: number): { name: string };
  export function getgrnam(uid: number): { name: string };
}
