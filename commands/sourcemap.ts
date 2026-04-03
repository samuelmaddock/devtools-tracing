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

  await traceModel.parse(traceData.traceEvents, {
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
  const outPath = tracePath.replace(/(\.(json|json\.gz))$/i, '.symbolicated$1');
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
