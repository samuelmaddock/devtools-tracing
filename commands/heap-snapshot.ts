import { loadHeapSnapshotFile } from '../';

/**
 * Loads and parses a `.heapsnapshot` file, then prints a summary of its size
 * breakdown and the classes retaining the most memory.
 */
export async function run(snapshotPath: string) {
  const snapshot = await loadHeapSnapshotFile(snapshotPath);

  const statistics = snapshot.getStatistics();
  const bytes = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MiB`;

  console.log(`Heap snapshot: ${snapshotPath}`);
  console.log('');
  console.log('Totals');
  console.log(`  nodes:        ${snapshot.nodeCount.toLocaleString()}`);
  console.log(`  total size:   ${bytes(snapshot.totalSize)}`);
  console.log('');
  console.log('Size by category');
  console.log(`  V8 heap:      ${bytes(statistics.v8heap.total)}`);
  console.log(`    code:       ${bytes(statistics.v8heap.code)}`);
  console.log(`    strings:    ${bytes(statistics.v8heap.strings)}`);
  console.log(`    JS arrays:  ${bytes(statistics.v8heap.jsArrays)}`);
  console.log(`    system:     ${bytes(statistics.v8heap.system)}`);
  console.log(`  native:       ${bytes(statistics.native.total)}`);
  console.log(`    typedArray: ${bytes(statistics.native.typedArrays)}`);
  console.log('');

  // Aggregate objects by constructor/class and show the biggest offenders by
  // retained size — the single most useful view for finding leaks.
  const aggregates = snapshot.getAggregatesByClassKey(false);
  const rows = Object.values(aggregates)
    .map((info) => ({
      name: info.name,
      count: info.count,
      self: info.self,
      maxRetained: info.maxRet,
    }))
    .sort((a, b) => b.maxRetained - a.maxRetained)
    .slice(0, 20);

  console.log('Top classes by max retained size');
  console.log(
    '  ' +
      'class'.padEnd(32) +
      'count'.padStart(10) +
      'self'.padStart(14) +
      'max retained'.padStart(16),
  );
  for (const row of rows) {
    console.log(
      '  ' +
        row.name.slice(0, 31).padEnd(32) +
        row.count.toLocaleString().padStart(10) +
        bytes(row.self).padStart(14) +
        bytes(row.maxRetained).padStart(16),
    );
  }
}
