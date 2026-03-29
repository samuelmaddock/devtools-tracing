import * as SDK from '../lib/front_end/core/sdk/sdk.js';
import * as Trace from '../lib/front_end/models/trace/trace.js';

type CallFrame = Trace.Types.Events.CallFrame;
type Event = Trace.Types.Events.Event;
type Script = Trace.Handlers.ModelHandlers.Scripts.Script;

type UrlString = SDK.SourceMap.SourceMap extends { url(): infer U } ? U : string;

export interface SourceMapResolverOptions {
  fetch?: (url: string) => Promise<Response>;
}

export function createSourceMapResolver(
  options: SourceMapResolverOptions = {},
): NonNullable<Trace.Types.Configuration.ParseOptions['resolveSourceMap']> {
  const fetchFn = options.fetch ?? globalThis.fetch;

  return async (params) => {
    const { sourceUrl, sourceMapUrl, cachedRawSourceMap } = params;

    // If the raw source map was cached in the trace metadata, use it directly.
    if (cachedRawSourceMap) {
      return new SDK.SourceMap.SourceMap(
        sourceUrl,
        sourceMapUrl || ('' as UrlString),
        cachedRawSourceMap,
      );
    }

    if (!sourceMapUrl) {
      return null;
    }

    // Try to parse data URL source maps (e.g. data:application/json;base64,...)
    if (sourceMapUrl.startsWith('data:')) {
      try {
        const content = decodeDataUrl(sourceMapUrl);
        const payload = SDK.SourceMap.parseSourceMap(content);
        return new SDK.SourceMap.SourceMap(
          sourceUrl,
          sourceMapUrl as UrlString,
          payload,
        );
      } catch {
        return null;
      }
    }

    // Try fetching the source map over the network.
    if (
      sourceMapUrl.startsWith('http://') ||
      sourceMapUrl.startsWith('https://')
    ) {
      try {
        const response = await fetchFn(sourceMapUrl);
        if (!response.ok) {
          return null;
        }
        const text = await response.text();
        const payload = SDK.SourceMap.parseSourceMap(text);
        return new SDK.SourceMap.SourceMap(
          sourceUrl,
          sourceMapUrl as UrlString,
          payload,
        );
      } catch {
        return null;
      }
    }

    return null;
  };
}

export interface SymbolicateResult {
  /** Number of individual CallFrames that were rewritten. */
  symbolicatedFrames: number;
  /** Number of trace events that contained at least one rewritten frame. */
  symbolicatedEvents: number;
}

/**
 * Symbolicate trace events in-place by rewriting CallFrame locations using
 * resolved source maps. Call this after `traceModel.parse()` has resolved
 * source maps via `resolveSourceMap`.
 *
 * @param traceEvents - The raw trace events array (mutated in-place).
 * @param scripts - The parsed scripts from `parsedTrace.data.Scripts.scripts`.
 */
export interface SymbolicateOptions {
  /** Rewrite the resolved source URL after symbolication. Line and column are 0-based. */
  rewriteSourceUrl?: (url: string, lineNumber: number, columnNumber: number) => string;
}

export function symbolicateTrace(
  traceEvents: readonly Event[],
  scripts: readonly Script[],
  options: SymbolicateOptions = {},
): SymbolicateResult {
  // Build lookup: script URL -> SourceMap
  const sourceMapByUrl = new Map<string, SDK.SourceMap.SourceMap>();
  for (const script of scripts) {
    if (script.url && script.sourceMap) {
      sourceMapByUrl.set(script.url, script.sourceMap);
    }
  }

  let symbolicatedFrames = 0;
  let symbolicatedEvents = 0;

  function symbolicateCallFrame(frame: CallFrame): boolean {
    const sourceMap = sourceMapByUrl.get(frame.url);
    if (!sourceMap) return false;

    // Trace events use 0-based line/column numbers in CallFrames.
    const entry = sourceMap.findEntry(frame.lineNumber, frame.columnNumber);
    if (!entry || entry.sourceURL === undefined) return false;

    let resolvedUrl = entry.sourceURL as string;
    if (options.rewriteSourceUrl) {
      resolvedUrl = options.rewriteSourceUrl(resolvedUrl, entry.sourceLineNumber, entry.sourceColumnNumber);
    }
    frame.url = resolvedUrl;
    frame.lineNumber = entry.sourceLineNumber;
    frame.columnNumber = entry.sourceColumnNumber;
    const name = entry.name
      ?? sourceMap.findOriginalFunctionName({line: frame.lineNumber, column: frame.columnNumber});
    if (name) {
      frame.functionName = name;
    }
    return true;
  }

  function symbolicateFrames(frames: CallFrame[]): number {
    let count = 0;
    for (const frame of frames) {
      if (symbolicateCallFrame(frame)) count++;
    }
    return count;
  }

  for (const event of traceEvents) {
    let eventHit = false;
    const args = event.args;
    if (!args) continue;

    const data = args.data;

    // Stack trace arrays (args.data.stackTrace, args.stackTrace,
    // beginData.stackTrace for RecalcStyle/Layout, and FunctionCall/ProfileCall).
    // Note: stackTraceInEvent returns the original array reference for stack
    // traces, so mutating those frames modifies the event in-place. For
    // FunctionCall/ProfileCall it returns new objects, but we handle those
    // cases below anyway (args.data url/lineNumber/columnNumber, callFrame).
    const stackTrace = Trace.Helpers.Trace.stackTraceInEvent(event);
    if (stackTrace) {
      const n = symbolicateFrames(stackTrace);
      symbolicatedFrames += n;
      if (n) eventHit = true;
    }

    // args.data.callFrame — single CallFrame (e.g. ProfileCall)
    const callFrame = (data as {callFrame?: CallFrame} | undefined)?.callFrame;
    if (callFrame) {
      if (symbolicateCallFrame(callFrame)) {
        symbolicatedFrames++;
        eventHit = true;
      }
    }

    // args.data itself with url + lineNumber + columnNumber (FunctionCall, EvaluateScript)
    if (data && 'url' in data && 'lineNumber' in data && 'columnNumber' in data) {
      if (symbolicateCallFrame(data as unknown as CallFrame)) {
        symbolicatedFrames++;
        eventHit = true;
      }
    }

    // args.data.cpuProfile.nodes[].callFrame — ProfileChunk CPU profile nodes
    const cpuProfile = (data as {cpuProfile?: {nodes?: {callFrame: CallFrame}[]}} | undefined)?.cpuProfile;
    if (cpuProfile?.nodes) {
      for (const node of cpuProfile.nodes) {
        if (node.callFrame && symbolicateCallFrame(node.callFrame)) {
          symbolicatedFrames++;
          eventHit = true;
        }
      }
    }

    if (eventHit) symbolicatedEvents++;
  }

  return { symbolicatedFrames, symbolicatedEvents };
}

function decodeDataUrl(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL');
  }
  const header = dataUrl.slice(0, commaIndex);
  const data = dataUrl.slice(commaIndex + 1);

  if (header.includes(';base64')) {
    return Buffer.from(data, 'base64').toString('utf-8');
  }
  return decodeURIComponent(data);
}
