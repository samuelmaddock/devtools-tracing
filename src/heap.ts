import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';

import * as i18n from '../lib/front_end/core/i18n/i18n.js';
import * as HeapSnapshotModel from '../lib/front_end/models/heap_snapshot/heap_snapshot.js';
import * as HeapSnapshotWorker from '../lib/front_end/entrypoints/heap_snapshot_worker/heap_snapshot_worker.js';

export type JSHeapSnapshot = HeapSnapshotWorker.HeapSnapshot.JSHeapSnapshot;

export interface LoadHeapSnapshotOptions {
  /**
   * Called with parsing/processing progress messages emitted by the underlying
   * heap-snapshot worker (e.g. "Processing snapshot…"). Defaults to a no-op.
   */
  onProgress?: (message: string) => void;
}

/**
 * Parses raw heap-snapshot JSON — supplied as a stream of string chunks — into
 * a `JSHeapSnapshot`. Use this when the source isn't a file on disk (e.g. a
 * snapshot arriving over CDP, or already in memory).
 *
 * The flow mirrors the `heapSnapshotLoader` test in the devtools-frontend
 * source (entrypoints/heap_snapshot_worker/HeapSnapshot.test.ts): feed the raw
 * JSON into a HeapSnapshotLoader, wait for parsing, then build the snapshot.
 */
export async function parseHeapSnapshot(
  chunks: AsyncIterable<string> | Iterable<string>,
  options: LoadHeapSnapshotOptions = {},
): Promise<JSHeapSnapshot> {
  // The dispatcher receives progress/serialization events from the worker
  // classes as `{eventName, data}`. Progress updates carry a serialized UI
  // string in `data`; we deserialize it and forward the text to the caller.
  const dispatcher =
    new HeapSnapshotWorker.HeapSnapshotWorkerDispatcher.HeapSnapshotWorkerDispatcher(
      (message: { eventName?: string; data?: unknown }) => {
        if (
          !options.onProgress ||
          message?.eventName !==
            HeapSnapshotModel.HeapSnapshotModel.HeapSnapshotProgressEvent.Update
        ) {
          return;
        }
        const { string, values } = i18n.i18n.deserializeUIString(
          String(message.data),
        );
        // Substitute placeholders (e.g. "Loading nodes… {PH1}%") with their
        // values so the forwarded text is human-readable.
        const text = string.replace(
          /\{(\w+)\}/g,
          (match, key) => (key in values ? String(values[key]) : match),
        );
        options.onProgress(text);
      },
    );

  const loader = new HeapSnapshotWorker.HeapSnapshotLoader.HeapSnapshotLoader(
    dispatcher,
  );

  for await (const chunk of chunks) {
    loader.write(chunk);
  }
  loader.close();
  await loader.parsingComplete;

  // `buildSnapshot` needs a second port to offload part of the graph work; a
  // MessageChannel + SecondaryInitManager provides it (same as the reference
  // test and `createJSHeapSnapshotForTesting`).
  const channel = new MessageChannel();
  new HeapSnapshotWorker.HeapSnapshot.SecondaryInitManager(channel.port2);
  try {
    return await loader.buildSnapshot(channel.port1);
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
}

/**
 * Loads and parses a `.heapsnapshot` file (the JSON format emitted by DevTools'
 * "Take heap snapshot" and by `v8.writeHeapSnapshot()`) into a
 * `JSHeapSnapshot`. Gzipped files (`.gz`) are decompressed transparently.
 *
 * The file is streamed rather than read into a single string: snapshots can
 * exceed V8's max string length (~512MB), which would make a single
 * `.toString()` throw `ERR_STRING_TOO_LONG`.
 */
export async function loadHeapSnapshotFile(
  snapshotPath: string,
  options: LoadHeapSnapshotOptions = {},
): Promise<JSHeapSnapshot> {
  const fileStream = fs.createReadStream(snapshotPath);
  const source = snapshotPath.endsWith('.gz')
    ? fileStream.pipe(zlib.createGunzip())
    : fileStream;

  // Decode incrementally so multi-byte UTF-8 characters that straddle a chunk
  // boundary aren't corrupted. Iterating the readable propagates stream errors
  // (e.g. bad gzip) as rejections and destroys the underlying file descriptor.
  const decoder = new StringDecoder('utf8');
  async function* toStringChunks(): AsyncGenerator<string> {
    for await (const chunk of source) {
      yield decoder.write(chunk as Buffer);
    }
    const tail = decoder.end();
    if (tail) {
      yield tail;
    }
  }

  return parseHeapSnapshot(toStringChunks(), options);
}
