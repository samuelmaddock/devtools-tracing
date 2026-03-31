import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

import { initDevToolsTracing, Trace, generateInvalidationsList } from '../';

const SelectorTimingsKey = Trace.Types.Events.SelectorTimingsKey;
const microToMilli = (us: number) =>
  Trace.Helpers.Timing.microToMilli(Trace.Types.Timing.Micro(us));

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

  const truncateSelector = (s: string) =>
    s.length > 80 ? `${s.slice(0, 77)}...` : s;

  // Top selectors by elapsed time
  const byElapsed = allTimings
    .sort(
      (a, b) =>
        b[SelectorTimingsKey.Elapsed] - a[SelectorTimingsKey.Elapsed],
    )
    .slice(0, TOP_N);

  // eslint-disable-next-line no-console
  console.log(`\n=== Top ${TOP_N} CSS Selectors by Elapsed Time ===\n`);
  // eslint-disable-next-line no-console
  console.table(
    Object.fromEntries(
      byElapsed.map((t, i) => [
        i + 1,
        {
          selector: truncateSelector(t[SelectorTimingsKey.Selector]),
          'elapsed (ms)': microToMilli(t[SelectorTimingsKey.Elapsed]),
          match_attempts: t[SelectorTimingsKey.MatchAttempts],
          match_count: t[SelectorTimingsKey.MatchCount],
          fast_reject_count: t[SelectorTimingsKey.FastRejectCount],
        },
      ]),
    ),
  );

  // Top selectors by match attempts
  const byAttempts = [...selectorMap.values()]
    .sort(
      (a, b) =>
        b[SelectorTimingsKey.MatchAttempts] -
        a[SelectorTimingsKey.MatchAttempts],
    )
    .slice(0, TOP_N);

  // eslint-disable-next-line no-console
  console.log(`\n=== Top ${TOP_N} CSS Selectors by Match Attempts ===\n`);
  // eslint-disable-next-line no-console
  console.table(
    Object.fromEntries(
      byAttempts.map((t, i) => [
        i + 1,
        {
          selector: truncateSelector(t[SelectorTimingsKey.Selector]),
          match_attempts: t[SelectorTimingsKey.MatchAttempts],
          'elapsed (ms)': microToMilli(t[SelectorTimingsKey.Elapsed]),
          match_count: t[SelectorTimingsKey.MatchCount],
          fast_reject_count: t[SelectorTimingsKey.FastRejectCount],
        },
      ]),
    ),
  );

  // --- Invalidation Tracking ---
  const invalidationsData = parsedTraceData.Invalidations;
  const allInvalidations: Trace.Types.Events.InvalidationTrackingEvent[] = [];
  for (const [, invalidations] of invalidationsData.invalidationsForEvent) {
    allInvalidations.push(...invalidations);
  }

  const { groupedByReason, backendNodeIds } = generateInvalidationsList(allInvalidations);
  const reasons = Object.entries(groupedByReason).sort((a, b) => b[1].length - a[1].length);

  // eslint-disable-next-line no-console
  console.log(
    `\n=== Invalidation Tracking (${allInvalidations.length} invalidations, ${backendNodeIds.size} unique nodes) ===\n`,
  );
  // eslint-disable-next-line no-console
  console.table(
    Object.fromEntries(
      reasons.map(([reason, invalidations], i) => [
        i + 1,
        {
          reason,
          count: invalidations.length,
        },
      ]),
    ),
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
  // eslint-disable-next-line no-console
  console.log(`\n=== Totals ===\n`);
  // eslint-disable-next-line no-console
  console.table({
    'Unique selectors': allTimings.length,
    'Total elapsed (ms)': microToMilli(totalElapsedUs),
    'Total match attempts': totalMatchAttempts,
    'Total match count': totalMatchCount,
  });
}
