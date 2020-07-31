import { asyncIter, PushAsyncIterator } from "ballvalve";
import { Compression } from "./compressed_bottle";
import { EncryptionInfo, Encryption } from "./encrypted_bottle";
import { FileMetadata } from "./file_bottle";
import { Hash, Verified, SignedStatus } from "./signed_bottle";

// events that are streamed from reading/writing an archive

export const EVENT_FILE = "file";
export const EVENT_ENCRYPTED = "encrypted";
export const EVENT_COMPRESSED = "compressed";
export const EVENT_SIGNED = "signed";
export const EVENT_BYTES = "byte-count";

export interface AsyncEvent {
  event: string;
}

export interface FileEvent extends AsyncEvent {
  event: typeof EVENT_FILE;
  displayName: string;
  metadata: FileMetadata;
  content?: AsyncIterator<Buffer>;
}

export function fileEvent(displayName: string, metadata: FileMetadata, content?: AsyncIterator<Buffer>): FileEvent {
  return { event: EVENT_FILE, displayName, metadata, content };
}

export interface EncryptedEvent extends AsyncEvent {
  event: typeof EVENT_ENCRYPTED;
  info: EncryptionInfo;
}

export function encryptedEvent(info: EncryptionInfo): EncryptedEvent {
  return { event: EVENT_ENCRYPTED, info };
}

export interface CompressedEvent extends AsyncEvent {
  event: typeof EVENT_COMPRESSED;
  method: Compression;
}

export function compressedEvent(method: Compression): CompressedEvent {
  return { event: EVENT_COMPRESSED, method };
}

export interface SignedEvent extends AsyncEvent {
  event: typeof EVENT_SIGNED;
  method: Hash;
  verified: Verified;
}

export function signedEvent(method: Hash, verified: Verified): SignedEvent {
  return { event: EVENT_SIGNED, method, verified };
}

export interface BytesEvent extends AsyncEvent {
  event: typeof EVENT_BYTES;
  name: string;
  bytes: number;
}

export function bytesEvent(name: string, bytes: number): BytesEvent {
  return { event: EVENT_BYTES, name, bytes };
}

export function countStream(
  inStream: AsyncIterator<Buffer>,
  events: PushAsyncIterator<AsyncEvent>,
  name: string = "",
): AsyncIterator<Buffer> {
  let count = 0;
  events.push(bytesEvent(name, count));

  return asyncIter(async function* () {
    for await (const data of asyncIter(inStream)) {
      count += data.length;
      events.push(bytesEvent(name, count));
      yield data;
    }
  }());
}

// for debugging, generate a pretty string from an event
export function eventToString(e: AsyncEvent): string {
  switch (e.event) {
    case EVENT_FILE:
      return `file: ${(e as FileEvent).displayName}`;
    case EVENT_BYTES:
      return `bytes(${(e as BytesEvent).name}) = ${(e as BytesEvent).bytes}`;
    case EVENT_COMPRESSED:
      return `compressed: ${Compression[(e as CompressedEvent).method]}`;
    case EVENT_ENCRYPTED:
      return `encrypted: ${Encryption[(e as EncryptedEvent).info.method]}`;
    case EVENT_SIGNED: {
      const se = e as SignedEvent;
      const by = se.verified.signedBy ? ` by ${se.verified.signedBy}` : "";
      return `signed: ${Hash[se.method]} ${SignedStatus[se.verified.status]}${by}`;
    }
    default:
      return "?";
  }
}
