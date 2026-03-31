import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

import { initDevToolsTracing, Trace } from '../';

export async function run(tracePath: string) {
  initDevToolsTracing();

  const fileData = fs.readFileSync(tracePath);
  const decompressedData = tracePath.endsWith('.gz')
    ? zlib.gunzipSync(fileData)
    : fileData;
  const traceData = JSON.parse(
    decompressedData.toString()
  ) as Trace.Types.File.TraceFile;

  const processor = Trace.Processor.TraceProcessor.createWithAllHandlers();
  await processor.parse(traceData.traceEvents, {});
  const insights = processor.insights!.get('NO_NAVIGATION');
  const longestInteractionEvent =
    insights!.model.INPBreakdown.longestInteractionEvent!;
  const inp = longestInteractionEvent.dur / 1000;
  console.log({
    insights: insights?.model.INPBreakdown,
    inp,
  });
}
