import * as Platform from '../lib/front_end/core/platform/platform.js';
import * as Trace from '../lib/front_end/models/trace/trace.js';

type TimeRangeCategoryStats = Record<string, number>;

export type EventCategorizeFunction = (event: Trace.Types.Events.Event) => string;

function defaultCategorizeEvent(event: Trace.Types.Events.Event): string {
  const category =
    Trace.Styles.getEventStyle(event.name as Trace.Types.Events.Name)?.category
      .name || Trace.Styles.getCategoryStyles().other.name;
  return category;
}

const categoryBreakdownCacheSymbol = Symbol('categoryBreakdownCache');

/**
 * Generate categorized stats for events within the given time range.
 *
 * Original implementation from TimelineRangeSummaryView.
 * https://source.chromium.org/chromium/chromium/src/+/main:third_party/devtools-frontend/src/front_end/panels/timeline/components/TimelineRangeSummaryView.ts;l=105;drc=b5804c61986a92fc88553f12f274b27879c63a9b
 */
export function statsForTimeRange(
    events: Trace.Types.Events.Event[], startTime: Trace.Types.Timing.Milli,
    endTime: Trace.Types.Timing.Milli,
    categorizeEvent: EventCategorizeFunction = defaultCategorizeEvent): TimeRangeCategoryStats {
  if (!events.length) {
    return {idle: endTime - startTime};
  }

  buildRangeStatsCacheIfNeeded(events);
  const aggregatedStats = subtractStats(aggregatedStatsAtTime(endTime), aggregatedStatsAtTime(startTime));
  const aggregatedTotal = Object.values(aggregatedStats).reduce((a, b) => a + b, 0);
  aggregatedStats['idle'] = Math.max(0, endTime - startTime - aggregatedTotal);
  return aggregatedStats;

  function aggregatedStatsAtTime(time: number): TimeRangeCategoryStats {
    const stats: TimeRangeCategoryStats = {};
    // @ts-expect-error TODO(crbug.com/1011811): Remove symbol usage.
    const cache = events[categoryBreakdownCacheSymbol];
    for (const category in cache) {
      const categoryCache = cache[category];
      const index =
          Platform.ArrayUtilities.upperBound(categoryCache.time, time, Platform.ArrayUtilities.DEFAULT_COMPARATOR);
      let value;
      if (index === 0) {
        value = 0;
      } else if (index === categoryCache.time.length) {
        value = categoryCache.value[categoryCache.value.length - 1];
      } else {
        const t0 = categoryCache.time[index - 1];
        const t1 = categoryCache.time[index];
        const v0 = categoryCache.value[index - 1];
        const v1 = categoryCache.value[index];
        value = v0 + (v1 - v0) * (time - t0) / (t1 - t0);
      }
      stats[category] = value;
    }
    return stats;
  }

  function subtractStats(a: TimeRangeCategoryStats, b: TimeRangeCategoryStats): TimeRangeCategoryStats {
    const result = Object.assign({}, a);
    for (const key in b) {
      result[key] -= b[key];
    }
    return result;
  }

  function buildRangeStatsCacheIfNeeded(events: Trace.Types.Events.Event[]): void {
    // @ts-expect-error TODO(crbug.com/1011811): Remove symbol usage.
    if (events[categoryBreakdownCacheSymbol]) {
      return;
    }

    const aggregatedStats: Record<string, {
      time: number[],
      value: number[],
    }> = {};
    const categoryStack: string[] = [];
    let lastTime = 0;
    Trace.Helpers.Trace.forEachEvent(events, {
      onStartEvent,
      onEndEvent,
    });

    function updateCategory(category: string, time: number): void {
      let statsArrays: {
        time: number[],
        value: number[],
      } = aggregatedStats[category];
      if (!statsArrays) {
        statsArrays = {time: [], value: []};
        aggregatedStats[category] = statsArrays;
      }
      if (statsArrays.time.length && statsArrays.time[statsArrays.time.length - 1] === time || lastTime > time) {
        return;
      }
      const lastValue = statsArrays.value.length > 0 ? statsArrays.value[statsArrays.value.length - 1] : 0;
      statsArrays.value.push(lastValue + time - lastTime);
      statsArrays.time.push(time);
    }

    function categoryChange(from: string|null, to: string|null, time: number): void {
      if (from) {
        updateCategory(from, time);
      }
      lastTime = time;
      if (to) {
        updateCategory(to, time);
      }
    }

    function onStartEvent(e: Trace.Types.Events.Event): void {
      const {startTime} = Trace.Helpers.Timing.eventTimingsMilliSeconds(e);
      const category = categorizeEvent(e);
      const parentCategory = categoryStack.length ? categoryStack[categoryStack.length - 1] : null;
      if (category !== parentCategory) {
        categoryChange(parentCategory || null, category, startTime);
      }
      categoryStack.push(category);
    }

    function onEndEvent(e: Trace.Types.Events.Event): void {
      const {endTime} = Trace.Helpers.Timing.eventTimingsMilliSeconds(e);
      const category = categoryStack.pop();
      const parentCategory = categoryStack.length ? categoryStack[categoryStack.length - 1] : null;
      if (category !== parentCategory) {
        categoryChange(category || null, parentCategory || null, endTime || 0);
      }
    }

    const obj = (events as Object);
    // @ts-expect-error TODO(crbug.com/1011811): Remove symbol usage.
    obj[categoryBreakdownCacheSymbol] = aggregatedStats;
  }
}


export function entryIsVisibleInTimeline(
    entry: Trace.Types.Events.Event, parsedTrace?: Trace.TraceModel.ParsedTrace): boolean {
  if (parsedTrace?.data.Meta.traceIsGeneric) {
    return true;
  }

  if (Trace.Types.Events.isUpdateCounters(entry)) {
    // These events are not "visible" on the timeline because they are instant events with 0 duration.
    // However, the Memory view (CountersGraph in the codebase) relies on
    // finding the UpdateCounters events within the user's active trace
    // selection in order to show the memory usage for the selected time
    // period.
    // Therefore we mark them as visible so they are appended onto the Thread
    // track, and hence accessible by the CountersGraph view.
    return true;
  }

  if (Trace.Types.Events.isSchedulePostMessage(entry) || Trace.Types.Events.isHandlePostMessage(entry)) {
    return true;
  }

  if (Trace.Types.Extensions.isSyntheticExtensionEntry(entry)) {
    return true;
  }

  // Default styles are globally defined for each event name. Some
  // events are hidden by default.
  const eventStyle = Trace.Styles.getEventStyle(entry.name as Trace.Types.Events.Name);
  const eventIsTiming = Trace.Types.Events.isConsoleTime(entry) || Trace.Types.Events.isPerformanceMeasure(entry) ||
      Trace.Types.Events.isPerformanceMark(entry) || Trace.Types.Events.isConsoleTimeStamp(entry);
  return (eventStyle && !eventStyle.hidden) || eventIsTiming;
}
