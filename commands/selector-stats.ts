import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

import { initDevToolsTracing, Trace } from '../';

const SelectorTimingsKey = Trace.Types.Events.SelectorTimingsKey;

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
  const parsedTraceData = parsedTrace.data;

  // --- Selector Stats ---
  const selectorStatsData = parsedTraceData.SelectorStats;
  const selectorMap = new Map<
    string,
    Trace.Types.Events.SelectorTiming
  >();

  for (const [, value] of selectorStatsData.dataForRecalcStyleEvent) {
    for (const timing of value.timings) {
      const key =
        timing[SelectorTimingsKey.Selector] +
        '_' +
        timing[SelectorTimingsKey.StyleSheetId];
      const existing = selectorMap.get(key);
      if (existing) {
        existing[SelectorTimingsKey.Elapsed] +=
          timing[SelectorTimingsKey.Elapsed];
        existing[SelectorTimingsKey.MatchAttempts] +=
          timing[SelectorTimingsKey.MatchAttempts];
        existing[SelectorTimingsKey.MatchCount] +=
          timing[SelectorTimingsKey.MatchCount];
        existing[SelectorTimingsKey.FastRejectCount] +=
          timing[SelectorTimingsKey.FastRejectCount];
      } else {
        selectorMap.set(key, { ...timing });
      }
    }
  }

  const allTimings = [...selectorMap.values()];
  const TOP_N = 15;

  // Top selectors by elapsed time
  const byElapsed = allTimings
    .sort(
      (a, b) =>
        b[SelectorTimingsKey.Elapsed] - a[SelectorTimingsKey.Elapsed],
    )
    .slice(0, TOP_N);

  console.log(`\n=== Top ${TOP_N} CSS Selectors by Elapsed Time ===\n`);
  for (const t of byElapsed) {
    const elapsedMs = (t[SelectorTimingsKey.Elapsed] / 1000).toFixed(2);
    console.log(
      `  ${elapsedMs}ms | attempts: ${t[SelectorTimingsKey.MatchAttempts]} | matches: ${t[SelectorTimingsKey.MatchCount]} | ${t[SelectorTimingsKey.Selector]}`,
    );
  }

  // Top selectors by match attempts
  const byAttempts = [...selectorMap.values()]
    .sort(
      (a, b) =>
        b[SelectorTimingsKey.MatchAttempts] -
        a[SelectorTimingsKey.MatchAttempts],
    )
    .slice(0, TOP_N);

  console.log(`\n=== Top ${TOP_N} CSS Selectors by Match Attempts ===\n`);
  for (const t of byAttempts) {
    const elapsedMs = (t[SelectorTimingsKey.Elapsed] / 1000).toFixed(2);
    console.log(
      `  ${t[SelectorTimingsKey.MatchAttempts]} attempts | ${elapsedMs}ms | matches: ${t[SelectorTimingsKey.MatchCount]} | ${t[SelectorTimingsKey.Selector]}`,
    );
  }

  // --- Invalidation Tracking ---
  const invalidatedNodes = selectorStatsData.invalidatedNodeList;
  console.log(
    `\n=== Invalidation Tracking (${invalidatedNodes.length} invalidated nodes) ===\n`,
  );

  // Aggregate selectors that caused invalidations
  const invalidationSelectorCounts = new Map<string, number>();
  for (const node of invalidatedNodes) {
    for (const sel of node.selectorList) {
      const count = invalidationSelectorCounts.get(sel.selector) ?? 0;
      invalidationSelectorCounts.set(sel.selector, count + 1);
    }
  }

  const topInvalidationSelectors = [...invalidationSelectorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N);

  console.log(
    `  Top ${TOP_N} selectors causing invalidations:\n`,
  );
  for (const [selector, count] of topInvalidationSelectors) {
    console.log(`  ${count}x | ${selector}`);
  }

  // Subtree vs single-node invalidations
  const subtreeCount = invalidatedNodes.filter((n) => n.subtree).length;
  console.log(
    `\n  Subtree invalidations: ${subtreeCount} / ${invalidatedNodes.length} total`,
  );

  // --- Totals ---
  let totalElapsedUs = 0;
  let totalMatchAttempts = 0;
  let totalMatchCount = 0;
  for (const t of allTimings) {
    totalElapsedUs += t[SelectorTimingsKey.Elapsed];
    totalMatchAttempts += t[SelectorTimingsKey.MatchAttempts];
    totalMatchCount += t[SelectorTimingsKey.MatchCount];
  }
  console.log(`\n=== Totals ===\n`);
  console.log(`  Unique selectors: ${allTimings.length}`);
  console.log(`  Total elapsed: ${(totalElapsedUs / 1000).toFixed(2)}ms`);
  console.log(`  Total match attempts: ${totalMatchAttempts}`);
  console.log(`  Total match count: ${totalMatchCount}`);
}
