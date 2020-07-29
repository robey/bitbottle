import { asyncIter, PushAsyncIterator } from "ballvalve";
import { EncryptionInfo } from "./encrypted_bottle";
import { FileMetadata } from "./file_bottle";

// events that are streamed from reading/writing an archive

const EVENT_FILE = "file";
const EVENT_BYTES = "byte-count";
const EVENT_ENCRYPTED = "encrypted";

export interface AsyncEvent {
  event: string;
}

export interface FileEvent extends AsyncEvent {
  event: typeof EVENT_FILE;
  metadata: FileMetadata;
  content?: AsyncIterator<Buffer>;
}

export function fileEvent(metadata: FileMetadata, content?: AsyncIterator<Buffer>): FileEvent {
  return { event: EVENT_FILE, metadata, content };
}

export interface EncryptedEvent extends AsyncEvent {
  event: typeof EVENT_ENCRYPTED;
  info: EncryptionInfo;
}

export function encryptedEvent(info: EncryptionInfo): EncryptedEvent {
  return { event: EVENT_ENCRYPTED, info };
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
