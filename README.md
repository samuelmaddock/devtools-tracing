# devtools-tracing

Node.js library for programmatic analysis of Chrome DevTools performance traces. Re-exports the trace processing engine from [chrome-devtools-frontend](https://www.npmjs.com/package/chrome-devtools-frontend) and provides higher-level utilities for common tasks.

## Install

```sh
npm install devtools-tracing
```

## CLI

Analyze traces directly from the command line:

```sh
npx devtools-tracing <command> <trace-file>
```

Supports both `.json` and `.json.gz` trace files.

### Commands

```sh
# Top CSS selectors by elapsed time and match attempts, plus invalidation tracking
npx devtools-tracing selector-stats trace.json.gz

# INP (Interaction to Next Paint) breakdown
npx devtools-tracing inp trace.json.gz

# Timeline category statistics
npx devtools-tracing stats trace.json.gz

# Source map symbolication (writes a .symbolicated.json.gz alongside the input)
npx devtools-tracing sourcemap trace.json.gz -H "Cookie: $cookie" -H "User-Agent: $ua"
```

See the [`commands/`](./commands) directory for full source.

## Library usage

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

## How it works

A [build script](./generate.ts) extracts trace-related code from the `chrome-devtools-frontend` npm package into `lib/`, resolving dependencies via AST analysis and stubbing browser APIs. The result is bundled into a single CommonJS file via esbuild.

## License

BSD-3-Clause, matching the license of [chrome-devtools-frontend](https://github.com/ChromeDevTools/devtools-frontend/blob/main/LICENSE).
