This project attempts to re-export the chrome-devtools-frontend npm package
such that it can be imported and used for analyzing performance profiles.

## Structure

package.json - includes chrome-devtools-frontend dependency
generate.ts - sets up `lib/` and cleans up scripts
lib/ - contains generated files which should not be modified outside of generate.ts
commands/ - CLI command implementations (css-selectors, inp, sourcemap, stats)
cli.ts - CLI entry point with subcommand routing
dist/ - the final distribution files, not to be edited directly

## Boundaries

NEVER modify files within the lib/ directory. These are imported from Chromium
and should be considered off limits.

## Coding preferences

ALWAYS prefer using utilities from the Chromium devtools frontend codebase.
Avoid writing custom utilities where one exists which can be imported.

Use types from lib/ (e.g. Trace.Types.Events.Event, Trace.Types.Events.ProcessID)
rather than defining custom interfaces for trace data.

Use type guard functions (e.g. isFunctionCall, isRundownScript,
isTracingStartedInBrowser) rather than raw string comparisons on event names.
