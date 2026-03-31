import { run as cssSelectors } from './commands/selector-stats.js';
import { run as inp } from './commands/inp.js';
import { run as sourcemap } from './commands/sourcemap.js';
import { run as stats } from './commands/stats.js';

const commands: Record<string, (tracePath: string) => Promise<void>> = {
  'selector-stats': cssSelectors,
  inp,
  sourcemap,
  stats,
};

function printUsage() {
  console.log('Usage: devtools-tracing <command> <trace-file>');
  console.log('\nCommands:');
  console.log('  selector-stats  Top CSS selectors from selector stats and invalidation tracking');
  console.log('  inp            Extract INP (Interaction to Next Paint) breakdown');
  console.log('  sourcemap      Symbolicate a trace using source maps');
  console.log('  stats          Generate timeline category statistics');
}

async function main() {
  const [command, tracePath] = process.argv.slice(2);

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

  await run(tracePath);
}

main();
