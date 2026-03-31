This project attempts to re-export the chrome-devtools-frontend npm package
such that it can be imported and used for analyzing performance profiles.

## Structure

package.json - includes chrome-devtools-frontend dependency
generate.ts - sets up `lib/` and cleans up scripts
lib/ - contains generated files which should not be modified outside of generate.ts
commands/ - CLI command implementations (css-selectors, inp, sourcemap, stats)
cli.ts - CLI entry point with subcommand routing
dist/ - the final distribution files, not to be edited directly
