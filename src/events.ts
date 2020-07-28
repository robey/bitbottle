import { FileMetadata } from "./file_bottle";
import { asyncIter } from "ballvalve";

// events that are streamed from reading/writing an archive

export const EVENT_DATA = "data";
export const EVENT_END_STREAM = "end-stream";

export interface AsyncEvent {
  event: string;
}

export interface DataEvent extends AsyncEvent {
  event: typeof EVENT_DATA;
  data: Buffer;
}

export function dataEvent(data: Buffer): DataEvent {
  return { event: EVENT_DATA, data };
}

// export function traverseData(
//   stream: AsyncIterable<AsyncEvent>,
//   transform: (bufferStream: AsyncIterable<Buffer>) => AsyncIterable<Buffer>,
// ): AsyncIterable<AsyncEvent> {
//   const [ dataStream, otherEvents ] = asyncIter(stream).partition(e => e.event == EVENT_DATA);
//   const bufferStream = async function* () {
//     for await (const data of transform(dataStream.map(e => (e as DataEvent).data))) {
//       yield dataEvent(data);
//     }
//   }();
//   return asyncIter(bufferStream).merge(otherEvents);
// }

export interface FileEvent extends AsyncEvent {
  event: "file";
  metadata: FileMetadata;
}

export function fileEvent(metadata: FileMetadata): FileEvent {
  return { event: "file", metadata };
}





// import { asyncIter, PushAsyncIterator } from "ballvalve";

// export interface CountEvent extends AsyncEvent {
//   name: string;
//   count: number;
// }

// export interface StreamAndCount {
//   stream: AsyncIterator<Buffer>;
//   countEvents: AsyncIterator<CountEvent>;
// }

// export function countingStream(
//   inStream: AsyncIterator<Buffer>,
//   name: string = "",
// ): StreamAndCount {
//   let count = 0;

//   const countEvents = new PushAsyncIterator<CountEvent>();
//   countEvents.push({ event, name, count });

//   const stream = asyncIter(async function* () {
//     for await (const data of asyncIter(inStream)) {
//       count += data.length;
//       countEvents.push({ event, name, count });
//       yield data;
//     }
//     countEvents.end();
//   }());

//   return { stream, countEvents };
// }
