This project attempts to re-export the chrome-devtools-frontend npm package
such that it can be imported and used for analyzing performance profiles.

## Structure

package.json - includes chrome-devtools-frontend dependency
generate.ts - sets up `lib/` and cleans up scripts
lib/ - contains generated files which should not be modified outside of generate.ts
dist/ - the final distribution files, not to be edited directly
