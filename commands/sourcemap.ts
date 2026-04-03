import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

import {
  initDevToolsTracing,
  createSourceMapResolver,
  symbolicateTrace,
  Trace,
} from '../';

export interface SourcemapOptions {
  headers?: Record<string, string>;
}

export async function run(tracePath: string, options?: SourcemapOptions) {
  initDevToolsTracing();

  const extraHeaders = options?.headers;

  const fileData = fs.readFileSync(tracePath);
  const decompressedData = tracePath.endsWith('.gz')
    ? zlib.gunzipSync(fileData)
    : fileData;
  const traceData = JSON.parse(
    decompressedData.toString(),
  ) as Trace.Types.File.TraceFile;

  const traceModel = Trace.TraceModel.Model.createWithAllHandlers();
  const resolveSourceMap = createSourceMapResolver({
    fetch: (url: string) => verboseFetch(url, extraHeaders),
  });

  const preprocessedEvents = fixupElectronTraceEvents(traceData.traceEvents);

  await traceModel.parse(preprocessedEvents, {
    isCPUProfile: false,
    isFreshRecording: false,
    metadata: traceData.metadata,
    showAllEvents: false,
    resolveSourceMap,
  });

  const parsedTrace = traceModel.parsedTrace(0)!;
  const parsedTraceData = parsedTrace.data;
  const scripts = parsedTraceData.Scripts.scripts;

  const metadataSourceMaps = traceData.metadata?.sourceMaps?.length ?? 0;
  console.log(`Found ${scripts.length} scripts in trace`);
  console.log(`Source maps in trace metadata: ${metadataSourceMaps}\n`);

  // Diagnostic: show script properties to explain resolution results.
  let withUrl = 0;
  let withFrame = 0;
  let withSourceMapUrl = 0;
  let withElided = 0;
  for (const script of scripts) {
    if (script.url) withUrl++;
    if (script.frame) withFrame++;
    if (script.sourceMapUrl) withSourceMapUrl++;
    if (script.sourceMapUrlElided) withElided++;
  }
  console.log('Script breakdown:');
  console.log(`  with url:                ${withUrl}`);
  console.log(`  with frame:              ${withFrame}`);
  console.log(`  with sourceMapUrl:       ${withSourceMapUrl}`);
  console.log(`  with sourceMapUrlElided: ${withElided}`);
  console.log(`  (resolution requires url + frame + sourceMapUrl/elided)\n`);

  let resolvedCount = 0;
  for (const script of scripts) {
    if (!script.sourceMap) {
      continue;
    }
    resolvedCount++;

    const sourceMap = script.sourceMap;
    const sourceURLs = sourceMap.sourceURLs();

    console.log(
      `  ${script.url || script.scriptId} -> ${sourceURLs.length} sources, ${sourceMap.mappings().length} mappings`,
    );
  }

  console.log(
    `Resolved source maps for ${resolvedCount} of ${scripts.length} scripts\n`,
  );

  // Symbolicate the raw trace events in-place using resolved source maps.
  const result = symbolicateTrace(traceData.traceEvents, scripts);
  console.log(
    `Symbolicated ${result.symbolicatedFrames} frames across ${result.symbolicatedEvents} events`,
  );

  // Write the symbolicated trace to a new file.
  const outPath = tracePath.replace(/(\.(json|trace|json\.gz))$/i, '.symbolicated$1');
  if (outPath === tracePath) {
    console.error(
      'Could not determine output path (expected .json or .json.gz extension)',
    );
    process.exit(1);
  }
  const outputJson = JSON.stringify(traceData);
  if (outPath.endsWith('.gz')) {
    fs.writeFileSync(outPath, zlib.gzipSync(outputJson));
  } else {
    fs.writeFileSync(outPath, outputJson);
  }
  console.log(`Wrote symbolicated trace to ${outPath}`);
}

type TraceEvent = Trace.Types.Events.Event;
type ProcessID = Trace.Types.Events.ProcessID;

const { isTracingStartedInBrowser, isFunctionCall, isRundownScript, isProcessName } = Trace.Types.Events;

/**
 * Fixes up traces recorded via Electron's contentTracing API.
 *
 * Electron's contentTracing calls TracingController::StartTracing() directly,
 * bypassing the DevTools TracingHandler. The TracingHandler is gated on a
 * `did_initiate_recording_` flag that's only set when tracing starts via CDP,
 * so TracingStartedInBrowser and FrameCommittedInBrowser events are never
 * emitted. Without these, the trace model's MetaHandler has no frame data and
 * ScriptsHandler cannot resolve source maps.
 *
 * This function synthesizes FrameCommittedInBrowser events from FunctionCall
 * frame/isolate associations and reorders v8-source-rundown events to appear
 * after FunctionCall events (so the isolate-to-frame map is populated first).
 */
function fixupElectronTraceEvents(events: readonly TraceEvent[]): readonly TraceEvent[] {
  // Skip if the trace already has TracingStartedInBrowser with frame data.
  const hasFrameData = events.some(
    e => isTracingStartedInBrowser(e) && e.args.data?.frames?.length,
  );
  if (hasFrameData) {
    return events;
  }

  const rundownCats = new Set<string>([
    'disabled-by-default-devtools.v8-source-rundown' satisfies Trace.Types.Events.RundownScript['cat'],
    'disabled-by-default-devtools.v8-source-rundown-sources' satisfies Trace.Types.Events.RundownScriptSource['cat'],
  ]);

  // 1. Build isolate->frame and frame->pid from FunctionCall events.
  const isolateToFrame = new Map<string, string>();
  const frameToPid = new Map<string, ProcessID>();
  for (const event of events) {
    if (!isFunctionCall(event)) continue;
    const data = event.args?.data;
    if (!data?.isolate || !data?.frame) continue;
    isolateToFrame.set(String(data.isolate), data.frame);
    frameToPid.set(data.frame, event.pid);
  }

  // 2. Derive a page URL for each frame from rundown script URLs.
  //    Prefer non-.js URLs (HTML documents), fall back to the script's origin.
  const frameToUrl = new Map<string, string>();
  for (const event of events) {
    if (!isRundownScript(event)) continue;
    const data = event.args.data;
    const url: string = data.url ?? '';
    const isolate = String(data.isolate ?? '');
    const frame = isolateToFrame.get(isolate);
    if (!frame || !url || !url.startsWith('http')) continue;

    const existing = frameToUrl.get(frame);
    const isDocument = !url.match(/\.(js|cjs|mjs|wasm)(\?|$)/i);
    const existingIsDocument = existing && !existing.match(/\.(js|cjs|mjs|wasm)(\?|$)/i);

    if (!existing || (isDocument && !existingIsDocument)) {
      frameToUrl.set(frame, url);
    }
  }

  // 3. Synthesize FrameCommittedInBrowser events for frames missing from Meta.
  const browserPid = events.find(
    e => isProcessName(e) && (e.args as any)?.name === 'Browser',
  )?.pid;

  const syntheticEvents: TraceEvent[] = [];
  for (const [frame, pid] of frameToPid) {
    const url = frameToUrl.get(frame) ?? '';
    syntheticEvents.push({
      cat: 'disabled-by-default-devtools.timeline',
      name: 'FrameCommittedInBrowser',
      ph: Trace.Types.Events.Phase.INSTANT,
      pid: browserPid ?? pid,
      tid: 0 as Trace.Types.Events.ThreadID,
      ts: 0 as Trace.Types.Timing.Micro,
      s: Trace.Types.Events.Scope.GLOBAL,
      args: {
        data: {
          frame,
          name: '',
          processId: pid,
          url,
        },
      },
    } as TraceEvent);
  }

  // 4. Reorder: synthetic frames first, then regular events, then rundown last.
  const regular: TraceEvent[] = [];
  const rundown: TraceEvent[] = [];
  for (const event of events) {
    if (rundownCats.has(event.cat)) {
      rundown.push(event);
    } else {
      regular.push(event);
    }
  }

  return [...syntheticEvents, ...regular, ...rundown];
}

async function verboseFetch(url: string, headers?: Record<string, string>): Promise<Response> {
  console.log(`[sourcemap] fetching ${url}`);
  const response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok) {
    console.warn(
      `[sourcemap] ${url} -> ${response.status} ${response.statusText}`,
    );
  } else {
    console.log(`[sourcemap] ${url} -> ok`);
  }
  return response;
}
