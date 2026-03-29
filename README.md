# devtools-tracing

Node.js library for programmatic analysis of Chrome DevTools performance traces. Re-exports the trace processing engine from [chrome-devtools-frontend](https://www.npmjs.com/package/chrome-devtools-frontend) and provides higher-level utilities for common tasks.

## Install

```sh
npm install devtools-tracing
```

## Quick start

```ts
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { initDevToolsTracing, Trace } from 'devtools-tracing';

// Must be called once before using the library.
initDevToolsTracing();

const raw = fs.readFileSync('trace.json.gz');
const traceData = JSON.parse(
  zlib.gunzipSync(raw).toString(),
) as Trace.Types.File.TraceFile;

const model = Trace.TraceModel.Model.createWithAllHandlers();
await model.parse(traceData.traceEvents, {
  isCPUProfile: false,
  isFreshRecording: false,
  metadata: traceData.metadata,
});

const parsedTrace = model.parsedTrace(0);
```

## Examples

Run with a trace file (`.json` or `.json.gz`):

```sh
# INP breakdown
npm run example:inp -- trace.json.gz

# Timeline category stats
npm run example:stats -- trace.json.gz

# Source map symbolication
npm run example:sourcemap -- trace.json.gz
```

See the [`examples/`](./examples) directory for full source.

## How it works

A [build script](./generate.ts) extracts trace-related code from the `chrome-devtools-frontend` npm package into `lib/`, resolving dependencies via AST analysis and stubbing browser APIs. The result is bundled into a single CommonJS file via esbuild.

## License

BSD-3-Clause, matching the license of [chrome-devtools-frontend](https://github.com/ChromeDevTools/devtools-frontend/blob/main/LICENSE).
