import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

import { initDevToolsTracing, Trace } from '../';

async function main() {
  const tracePath = process.argv[2];
  if (!tracePath) {
    console.error('Usage: npm run examples:inp <path-to-trace-file>');
    process.exit(1);
  }
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

main();
