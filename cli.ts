import { run as cssSelectors } from './commands/selector-stats.js';
import { run as inp } from './commands/inp.js';
import { run as sourcemap, type SourcemapOptions } from './commands/sourcemap.js';
import { run as stats } from './commands/stats.js';
import { run as heapSnapshot } from './commands/heap-snapshot.js';

const commands: Record<string, (tracePath: string, ...args: any[]) => Promise<void>> = {
  'selector-stats': cssSelectors,
  inp,
  sourcemap,
  stats,
  'heap-snapshot': heapSnapshot,
};

function printUsage() {
  console.log('Usage: devtools-tracing <command> <trace-file>');
  console.log('\nCommands:');
  console.log('  selector-stats  Top CSS selectors from selector stats and invalidation tracking');
  console.log('  inp            Extract INP (Interaction to Next Paint) breakdown');
  console.log('  sourcemap      Symbolicate a trace using source maps [-H "Header: value"]');
  console.log('  stats          Generate timeline category statistics');
  console.log('  heap-snapshot  Load a .heapsnapshot file and print size stats');
}

function parseHeaders(args: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-H' && i + 1 < args.length) {
      const value = args[++i];
      const colonIdx = value.indexOf(':');
      if (colonIdx === -1) {
        console.error(`Invalid header (missing ':'): ${value}`);
        process.exit(1);
      }
      headers[value.slice(0, colonIdx).trim()] = value.slice(colonIdx + 1).trim();
    }
  }
  return headers;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const tracePath = args[1];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  const run = commands[command];
  if (!run) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  if (!tracePath) {
    console.error(`Missing trace file path.`);
    console.error(`Usage: devtools-tracing ${command} <trace-file>`);
    process.exit(1);
  }

  if (command === 'sourcemap') {
    const headers = parseHeaders(args.slice(2));
    const options: SourcemapOptions = Object.keys(headers).length > 0 ? { headers } : {};
    await sourcemap(tracePath, options);
  } else {
    await run(tracePath);
  }
}

main();
