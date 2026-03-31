import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

import {
  initDevToolsTracing,
  entryIsVisibleInTimeline,
  statsForTimeRange,
  Trace,
} from '../';

export async function run(tracePath: string) {
  initDevToolsTracing();

  const fileData = fs.readFileSync(tracePath);
  const decompressedData = tracePath.endsWith('.gz')
    ? zlib.gunzipSync(fileData)
    : fileData;
  const traceData = JSON.parse(
    decompressedData.toString(),
  ) as Trace.Types.File.TraceFile;

  const traceModel = Trace.TraceModel.Model.createWithAllHandlers({
    debugMode: true,
    enableAnimationsFrameHandler: false,
    maxInvalidationEventsPerEvent: 20,
    showAllEvents: false,
  });
  await traceModel.parse(traceData.traceEvents, {
    isCPUProfile: false,
    isFreshRecording: false,
    metadata: traceData.metadata,
    showAllEvents: false,
  });
  const parsedTrace = traceModel.parsedTrace(0)!;
  const parsedTraceData = parsedTrace!.data!;

  const startTime = Trace.Helpers.Timing.microToMilli(
    parsedTraceData.Meta.traceBounds.min,
  );
  const endTime = Trace.Helpers.Timing.microToMilli(
    parsedTraceData.Meta.traceBounds.max,
  );

  const threads = Trace.Handlers.Threads.threadsInTrace(parsedTrace.data);
  const mainThread = threads.find(
    (t) => t.type === Trace.Handlers.Threads.ThreadType.MAIN_THREAD,
  );
  if (!mainThread) {
    throw new Error('No renderer main thread found in trace file');
  }

  const rendererEvents = [...mainThread.entries].filter((e) =>
    entryIsVisibleInTimeline(e, parsedTrace),
  );
  const stats = statsForTimeRange(rendererEvents, startTime, endTime);

  console.log(stats);
}
