#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@typescript-eslint/typescript-estree';

/**
 * Script to copy files and directories from chrome-devtools-frontend dependency
 * into a local lib/ directory for easier development and customization.
 *
 * Features:
 * - Automatic dependency resolution
 * - Transitive dependency copying
 * - Handles both .ts and .js imports
 * - Supports barrel exports (index files)
 */

const SOURCE_BASE = path.join(
  __dirname,
  'node_modules',
  'chrome-devtools-frontend'
);
const TARGET_BASE = path.join(__dirname, 'lib');

interface CopyItem {
  source: string;
  target?: string; // Optional custom target path, defaults to same relative path
  resolveDependencies?: boolean; // Whether to automatically resolve and copy dependencies
  exportFilter?: string[]; // Optional: only trace dependencies for these specific exports
  excludeCategories?: string[]; // Optional: exclude dependencies matching these path patterns
}

const COMMON_EXCLUSION_CATEGORIES = [
  // Conservative exclusions - only exclude what we're sure is not needed
  // 'models/emulation', // Device emulation
  // 'models/persistence', // File system features
  // 'models/ai_assistance', // AI features
  // 'models/live-metrics', // Live metrics
  // 'models/crux-manager', // CrUX data

  // Panel exclusions - exclude other panels (this is safe)
  'panels/(?!timeline)', // All panels except timeline

  // Include only third_party which are required
  'third_party/(?!codemirror.next|i18n|intl-messageformat|legacy-javascript|source-map-scopes-codec|third-party-web)',
  
  // Note: This is more aggressive - excluding all UI components
  // May need to add back specific UI components if errors occur
];

// List of files and directories to copy
const COPY_LIST: CopyItem[] = [
  {
    source: 'front_end/models/trace/trace.ts',
    resolveDependencies: true,
    excludeCategories: COMMON_EXCLUSION_CATEGORIES,
  },
  {
    source: 'front_end/entrypoints/heap_snapshot_worker/heap_snapshot_worker.ts',
    resolveDependencies: true,
    excludeCategories: COMMON_EXCLUSION_CATEGORIES,
  }
];

// DOM API globals that indicate browser-only code when used in function bodies
const DOM_API_GLOBALS = [
  'document',
  'window',
  'navigator',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
  'customElements',
  'attachShadow',
  'shadowRoot',
  'CSSStyleSheet',
  'localStorage',
  'sessionStorage',
];

const DOM_API_SET = new Set(DOM_API_GLOBALS);

// Track processed files to avoid infinite loops and duplicates
const processedFiles = new Set<string>();
const dependencyQueue: string[] = [];
const cssStubsGenerated = new Set<string>();
const generatedFileStubsGenerated = new Set<string>();
const thirdPartyDirsCopied = new Set<string>();

/**
 * Resolves import path to actual file path, handling .js/.ts extensions and barrel exports
 */
function resolveImportPath(
  importPath: string,
  fromFile: string
): string | null {
  const fromDir = path.dirname(fromFile);
  let resolvedPath = path.resolve(path.join(SOURCE_BASE, fromDir), importPath);

  // Make path relative to SOURCE_BASE
  resolvedPath = path.relative(SOURCE_BASE, resolvedPath);

  // Handle CSS imports by generating stubs
  if (isCssImport(importPath)) {
    generateCssStub(resolvedPath);
    return resolvedPath; // Return the path so it's tracked as processed
  }

  // Handle generated file imports by generating stubs
  if (isGeneratedFileImport(importPath)) {
    generateGeneratedFileStub(resolvedPath);
    return resolvedPath; // Return the path so it's tracked as processed
  }

  // Try different extensions and patterns
  const candidates = [
    resolvedPath,
    resolvedPath.replace(/\.js$/, '.ts'),
    resolvedPath.replace(/\.js$/, '.d.ts'),
    resolvedPath + '.ts',
    resolvedPath + '.d.ts',
    resolvedPath + '.js',
    path.join(resolvedPath, 'index.ts'),
    path.join(resolvedPath, 'index.d.ts'),
    path.join(resolvedPath, resolvedPath.split('/').pop() + '.ts'), // barrel export pattern
    path.join(resolvedPath, resolvedPath.split('/').pop() + '.d.ts'), // barrel export pattern for .d.ts
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(SOURCE_BASE, candidate);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return candidate;
    }
  }

  return null;
}

/**
 * Extracts import and export statements from a TypeScript file using AST parsing
 */
function extractImports(filePath: string): string[] {
  const fullPath = path.join(SOURCE_BASE, filePath);
  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const imports: string[] = [];

  try {
    // Parse the TypeScript file into an AST
    const ast = parse(content, {
      loc: true,
      range: true,
      comment: false,
      tokens: false,
      errorOnUnknownASTType: false,
      errorOnTypeScriptSyntacticAndSemanticIssues: false,
      jsx: false,
    });

    // Walk the AST to find import and export declarations
    function walkNode(node: any): void {
      if (!node || typeof node !== 'object') {
        return;
      }

      // Handle ImportDeclaration nodes
      if (node.type === 'ImportDeclaration' && node.source?.value) {
        const importPath = node.source.value;
        // Only process relative imports (not node_modules)
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          imports.push(importPath);
        }
      }

      // Handle ExportNamedDeclaration and ExportAllDeclaration nodes
      if (
        (node.type === 'ExportNamedDeclaration' ||
          node.type === 'ExportAllDeclaration') &&
        node.source?.value
      ) {
        const importPath = node.source.value;
        // Only process relative imports (not node_modules)
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          imports.push(importPath);
        }
      }

      // Handle dynamic imports: import('path')
      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'Import' &&
        node.arguments?.[0]?.type === 'Literal'
      ) {
        const importPath = node.arguments[0].value;
        if (
          typeof importPath === 'string' &&
          (importPath.startsWith('./') || importPath.startsWith('../'))
        ) {
          imports.push(importPath);
        }
      }

      // Recursively walk child nodes
      for (const key in node) {
        if (key === 'parent') continue; // Avoid circular references
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(walkNode);
        } else if (child && typeof child === 'object') {
          walkNode(child);
        }
      }
    }

    walkNode(ast);
  } catch (error) {
    console.warn(
      `Failed to parse ${filePath} with AST, falling back to regex:`,
      error.message
    );

    // Fallback to regex for files that can't be parsed
    const importRegexes = [
      /import\s+.*?\s+from\s+['"`]([^'"`]+)['"`]/gs,
      /import\s+['"`]([^'"`]+)['"`]/g,
      /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    ];

    for (const regex of importRegexes) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          imports.push(importPath);
        }
      }
    }
  }

  return [...new Set(imports)]; // Remove duplicates
}

/**
 * Recursively finds all dependencies of a file
 */
function findDependencies(
  filePath: string,
  visited = new Set<string>(),
  excludeCategories: string[] = []
): string[] {
  if (visited.has(filePath)) {
    return [];
  }
  visited.add(filePath);

  const dependencies: string[] = [];
  const imports = extractImports(filePath);

  for (const importPath of imports) {
    const resolvedPath = resolveImportPath(importPath, filePath);
    if (resolvedPath && !visited.has(resolvedPath)) {
      // Check if this dependency should be excluded
      if (shouldExcludeDependency(resolvedPath, excludeCategories)) {
        console.log(
          `Excluding dependency: ${resolvedPath} (matches exclusion pattern)`
        );
        continue;
      }

      dependencies.push(resolvedPath);
      // Recursively find dependencies of this dependency
      dependencies.push(
        ...findDependencies(resolvedPath, visited, excludeCategories)
      );
    }
  }

  return dependencies;
}

/**
 * Checks if a dependency should be excluded based on category patterns
 */
function shouldExcludeDependency(
  filePath: string,
  excludeCategories: string[]
): boolean {
  if (!excludeCategories.length) {
    return false;
  }

  return excludeCategories.some((category) => {
    // Convert category pattern to a more flexible match
    const pattern = category.replace(/\*/g, '.*');
    const regex = new RegExp(pattern);
    return regex.test(filePath);
  });
}

/**
 * Checks if an import path is a CSS file that should be stubbed
 */
function isCssImport(importPath: string): boolean {
  return importPath.endsWith('.css.js') || importPath.endsWith('.css');
}

/**
 * Checks if an import path is a generated file that should be stubbed
 */
function isGeneratedFileImport(importPath: string): boolean {
  // Handle specific generated files
  return importPath.endsWith('/locales.js') || importPath === './locales.js';
}

/**
 * Checks if a file path is part of a third-party library that needs its entire directory copied
 */
function isThirdPartyDirectory(filePath: string): boolean {
  // Third-party libraries that need their entire directory structure
  return (
    filePath.includes('/third_party/codemirror.next/') ||
    filePath.includes('/third_party/marked/') ||
    filePath.includes('/third_party/acorn/') ||
    filePath.includes('/third_party/')
  );
}

/**
 * Generates a stub file for CSS imports
 */
function generateCssStub(cssPath: string): void {
  if (cssStubsGenerated.has(cssPath)) {
    return;
  }

  cssStubsGenerated.add(cssPath);

  const fullPath = path.join(TARGET_BASE, cssPath);
  const targetDir = path.dirname(fullPath);
  ensureDir(targetDir);

  // Generate a simple CSS stub that exports an empty CSSStyleSheet
  const stubContent = `// Auto-generated CSS stub for ${path.basename(cssPath)}
// This file replaces the original CSS-in-JS file for standalone usage

export default {};
`;

  fs.writeFileSync(fullPath, stubContent);
  console.log(`Generated CSS stub: ${cssPath}`);
}

/**
 * Generates a stub file for generated files like locales.js
 */
function generateGeneratedFileStub(filePath: string): void {
  if (generatedFileStubsGenerated.has(filePath)) {
    return;
  }

  generatedFileStubsGenerated.add(filePath);

  const fullPath = path.join(TARGET_BASE, filePath);
  const targetDir = path.dirname(fullPath);
  ensureDir(targetDir);

  let stubContent = '';

  // Handle specific generated files
  if (filePath.endsWith('/locales.js') || filePath === './locales.js') {
    stubContent = `// Auto-generated stub for locales.js
// This file replaces the original generated locales file for standalone usage

/** The list of all supported locales of DevTools */
export const LOCALES = ['en-US'];

/** A subset of LOCALES that are bundled with Chromium. The rest is fetched remotely */
export const BUNDLED_LOCALES = ['en-US'];

export const DEFAULT_LOCALE = 'en-US';

export const REMOTE_FETCH_PATTERN = 'https://devtools://devtools/@VERSION@/locales/@LOCALE@.json';

export const LOCAL_FETCH_PATTERN = './locales/@LOCALE@.json';
`;
  } else {
    // Generic stub for other generated files
    stubContent = `// Auto-generated stub for ${path.basename(filePath)}
// This file replaces the original generated file for standalone usage

export default {};
`;
  }

  fs.writeFileSync(fullPath, stubContent);
  console.log(`Generated generated file stub: ${filePath}`);
}

/**
 * Copies an entire third-party directory to preserve its structure
 */
function copyThirdPartyDirectory(filePath: string): void {
  // Extract the third-party directory path (e.g., front_end/third_party/codemirror.next)
  const thirdPartyMatch = filePath.match(/(.*\/third_party\/[^/]+)/);
  if (!thirdPartyMatch) {
    return;
  }

  const thirdPartyDir = thirdPartyMatch[1];

  if (thirdPartyDirsCopied.has(thirdPartyDir)) {
    return;
  }

  thirdPartyDirsCopied.add(thirdPartyDir);

  const sourcePath = path.join(SOURCE_BASE, thirdPartyDir);
  const targetPath = path.join(TARGET_BASE, thirdPartyDir);

  if (!fs.existsSync(sourcePath)) {
    console.warn(`Third-party directory not found: ${sourcePath}`);
    return;
  }

  console.log(`Copying entire third-party directory: ${thirdPartyDir}`);
  copyDirectory(sourcePath, targetPath);
}

/**
 * Ensures a directory exists, creating it recursively if needed
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

/**
 * Copies a file from source to target, creating directories as needed
 */
function copyFile(sourcePath: string, targetPath: string): void {
  const targetDir = path.dirname(targetPath);
  ensureDir(targetDir);

  fs.copyFileSync(sourcePath, targetPath);
  console.log(`Copied: ${sourcePath} -> ${targetPath}`);
}

/**
 * Recursively copies a directory and all its contents
 */
function copyDirectory(sourcePath: string, targetPath: string): void {
  ensureDir(targetPath);

  const items = fs.readdirSync(sourcePath);

  for (const item of items) {
    const sourceItemPath = path.join(sourcePath, item);
    const targetItemPath = path.join(targetPath, item);

    const stat = fs.statSync(sourceItemPath);

    if (stat.isDirectory()) {
      copyDirectory(sourceItemPath, targetItemPath);
    } else {
      copyFile(sourceItemPath, targetItemPath);
    }
  }
}

/**
 * Copies a single file if not already processed
 */
function copyFileIfNeeded(filePath: string): void {
  if (processedFiles.has(filePath)) {
    return;
  }

  processedFiles.add(filePath);

  // Check if this is part of a third-party directory that needs full copying
  if (isThirdPartyDirectory(filePath)) {
    copyThirdPartyDirectory(filePath);
    return;
  }

  const sourcePath = path.join(SOURCE_BASE, filePath);
  const targetPath = path.join(TARGET_BASE, filePath);

  if (!fs.existsSync(sourcePath)) {
    console.warn(`Dependency not found: ${sourcePath}`);
    return;
  }

  console.log(`Copying dependency: ${filePath}`);
  copyFile(sourcePath, targetPath);
}

/**
 * Processes a single copy item from the COPY_LIST
 */
function processCopyItem(item: CopyItem): void {
  const sourcePath = path.join(SOURCE_BASE, item.source);
  const targetRelativePath = item.target || item.source;
  const targetPath = path.join(TARGET_BASE, targetRelativePath);

  if (!fs.existsSync(sourcePath)) {
    console.error(`Source not found: ${sourcePath}`);
    return;
  }

  const stat = fs.statSync(sourcePath);

  if (stat.isDirectory()) {
    console.log(`Copying directory: ${item.source}`);
    copyDirectory(sourcePath, targetPath);
  } else {
    console.log(`Copying file: ${item.source}`);
    copyFile(sourcePath, targetPath);
    processedFiles.add(item.source);

    // Resolve and copy dependencies if requested
    if (item.resolveDependencies) {
      console.log(`Resolving dependencies for: ${item.source}`);
      const dependencies = findDependencies(
        item.source,
        new Set(),
        item.excludeCategories || []
      );

      if (item.excludeCategories?.length) {
        console.log(
          `Excluding categories: ${item.excludeCategories.join(', ')}`
        );
      }

      console.log(`Found ${dependencies.length} dependencies`);
      for (const dep of dependencies) {
        copyFileIfNeeded(dep);
      }
    }
  }
}

/**
 * Checks if an AST node tree contains references to DOM API globals.
 * Walks the AST looking for actual runtime references to known DOM globals,
 * skipping type annotations and property key positions.
 */
function containsDomApiUsage(node: any, parentKey?: string): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }

  // Skip type annotation nodes (they don't represent runtime DOM access)
  if (
    node.type === 'TSTypeAnnotation' ||
    node.type === 'TSTypeReference' ||
    node.type === 'TSTypeParameterDeclaration' ||
    node.type === 'TSTypeParameterInstantiation' ||
    node.type === 'TSInterfaceDeclaration' ||
    node.type === 'TSTypeAliasDeclaration'
  ) {
    return false;
  }

  // Check Identifier nodes that are DOM globals, but only when used as
  // actual runtime references — not as property keys in object literals
  // or as member access property names (e.g., `UIStrings.requestAnimationFrame`).
  if (node.type === 'Identifier' && DOM_API_SET.has(node.name) && parentKey !== 'key' && parentKey !== 'property') {
    return true;
  }

  // Check MemberExpression where the object is a DOM global (e.g., document.createElement)
  if (
    node.type === 'MemberExpression' &&
    node.object?.type === 'Identifier' &&
    DOM_API_SET.has(node.object.name)
  ) {
    return true;
  }

  // Check MemberExpression where the property is a DOM global accessed on
  // a known ambient object (e.g., self.localStorage, self.document)
  if (
    node.type === 'MemberExpression' &&
    node.property?.type === 'Identifier' &&
    DOM_API_SET.has(node.property.name) &&
    node.object?.type === 'Identifier' &&
    (node.object.name === 'self' || node.object.name === 'globalThis')
  ) {
    return true;
  }

  // Check `new` expressions for DOM constructors (e.g., new MutationObserver)
  if (
    node.type === 'NewExpression' &&
    node.callee?.type === 'Identifier' &&
    DOM_API_SET.has(node.callee.name)
  ) {
    return true;
  }

  // Recurse into child nodes, passing the property key so children
  // can determine if they're in a "key" vs "value" position.
  for (const key in node) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      if (child.some(c => containsDomApiUsage(c, key))) {
        return true;
      }
    } else if (child && typeof child === 'object' && child.type) {
      if (containsDomApiUsage(child, key)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Stubs out functions that interact with DOM APIs in a single file.
 * Returns the number of functions stubbed.
 */
function stubDomFunctionsInFile(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  let stubCount = 0;

  try {
    const ast = parse(content, {
      loc: true,
      range: true,
      comment: false,
      tokens: false,
      errorOnUnknownASTType: false,
      errorOnTypeScriptSyntacticAndSemanticIssues: false,
      jsx: false,
    });

    // Collect function bodies that use DOM APIs
    const replacements: Array<{ start: number; end: number; isExpression: boolean }> = [];

    function visit(node: any): void {
      if (!node || typeof node !== 'object') {
        return;
      }

      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        const body = node.body;
        if (body && body.range) {
          if (containsDomApiUsage(body)) {
            const isExpression = node.type === 'ArrowFunctionExpression' && body.type !== 'BlockStatement';
            replacements.push({
              start: body.range[0],
              end: body.range[1],
              isExpression,
            });
          }
        }
      }

      // Recurse into child nodes
      for (const key in node) {
        if (key === 'parent') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(visit);
        } else if (child && typeof child === 'object' && child.type) {
          visit(child);
        }
      }
    }

    visit(ast);

    if (replacements.length === 0) {
      return 0;
    }

    // Sort by start position and filter to keep only outermost (non-overlapping) replacements
    replacements.sort((a, b) => a.start - b.start);
    const outermost: typeof replacements = [];
    let lastEnd = -1;
    for (const r of replacements) {
      if (r.start >= lastEnd) {
        outermost.push(r);
        lastEnd = r.end;
      }
      // else: nested inside a previous replacement, skip
    }

    // Apply replacements from end to start so offsets remain valid
    outermost.reverse();
    let result = content;
    const isTs = filePath.endsWith('.ts');
    const asAny = isTs ? ' as any' : '';
    for (const r of outermost) {
      const stub = r.isExpression
        ? `undefined${asAny} /* DOM API stubbed */`
        : `{\n    // DOM API stubbed\n    return undefined${asAny};\n  }`;
      result = result.substring(0, r.start) + stub + result.substring(r.end);
      stubCount++;
    }

    fs.writeFileSync(filePath, result);
  } catch (error) {
    // Skip files that can't be parsed (e.g., .d.ts with unsupported syntax)
  }

  return stubCount;
}

/**
 * Recursively collects all .ts and .js files in a directory
 */
function collectFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) {
    return files;
  }
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some(ext => item.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Stubs top-level await expressions in a file.
 * Top-level await is not supported in CJS (used by tsx/esbuild).
 * Replaces `await <expr>` at module scope with `undefined as any`.
 * Returns the number of top-level awaits stubbed.
 */
function stubTopLevelAwaitInFile(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  let stubCount = 0;

  try {
    const ast = parse(content, {
      loc: true,
      range: true,
      comment: false,
      tokens: false,
      errorOnUnknownASTType: false,
      errorOnTypeScriptSyntacticAndSemanticIssues: false,
      jsx: false,
    });

    const replacements: Array<{ start: number; end: number }> = [];

    // Only look at top-level statements (not inside functions/classes)
    for (const node of (ast as any).body ?? []) {
      findTopLevelAwaits(node, replacements, content);
    }

    if (replacements.length === 0) {
      return 0;
    }

    // Apply from end to start
    replacements.sort((a, b) => b.start - a.start);
    let result = content;
    for (const r of replacements) {
      result = result.substring(0, r.start) + 'undefined as any /* top-level await stubbed */' + result.substring(r.end);
      stubCount++;
    }

    fs.writeFileSync(filePath, result);
  } catch (error) {
    // Skip unparseable files
  }

  return stubCount;
}

/**
 * Finds AwaitExpression nodes within a top-level statement,
 * without descending into nested function/class scopes.
 */
function findTopLevelAwaits(
  node: any,
  replacements: Array<{ start: number; end: number }>,
  content: string,
): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (node.type === 'AwaitExpression' && node.range) {
    replacements.push({ start: node.range[0], end: node.range[1] });
    return; // Don't recurse into the awaited expression
  }

  // Don't descend into nested scopes — those are not top-level
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression'
  ) {
    return;
  }

  for (const key in node) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      child.forEach(c => findTopLevelAwaits(c, replacements, content));
    } else if (child && typeof child === 'object' && child.type) {
      findTopLevelAwaits(child, replacements, content);
    }
  }
}

/**
 * Replaces the stubbed HOST_RUNTIME with a synchronous Node.js implementation.
 */
function fixHostRuntime(): void {
  const hostRuntimePath = path.join(TARGET_BASE, 'front_end/core/platform/HostRuntime.ts');
  if (!fs.existsSync(hostRuntimePath)) {
    return;
  }
  let content = fs.readFileSync(hostRuntimePath, 'utf-8');
  const stub = 'undefined as any /* top-level await stubbed */';
  if (!content.includes(stub)) {
    return;
  }
  const nodeRuntime = `{
  createWorker(_url: string): Api.HostRuntime.Worker { throw new Error('Workers not supported in Node.js tracing context'); },
  workerScope: { postMessage() {}, set onmessage(_: any) {} },
  getOnLine() { return true; },
  getUserAgent() { return 'Node.js'; },
  getLocalStorage() { return undefined; },
} satisfies Api.HostRuntime.HostRuntime`;
  content = content.replace(stub, nodeRuntime);
  fs.writeFileSync(hostRuntimePath, content);
  console.log('  Fixed HOST_RUNTIME with Node.js implementation');
}

/**
 * Post-processes all files in the target directory, applying generic
 * transformations: stubbing top-level awaits and DOM API functions.
 */
function postProcessLibFiles(): void {
  const files = collectFiles(TARGET_BASE, ['.ts', '.js']);
  let totalDomStubbed = 0;
  let totalAwaitStubbed = 0;

  for (const file of files) {
    // Skip .d.ts declaration files (type-only, no runtime code)
    if (file.endsWith('.d.ts')) {
      continue;
    }
    const relPath = path.relative(TARGET_BASE, file);

    const awaitCount = stubTopLevelAwaitInFile(file);
    if (awaitCount > 0) {
      console.log(`  Stubbed ${awaitCount} top-level await(s) in ${relPath}`);
      totalAwaitStubbed += awaitCount;
    }

    const domCount = stubDomFunctionsInFile(file);
    if (domCount > 0) {
      console.log(`  Stubbed ${domCount} DOM function(s) in ${relPath}`);
      totalDomStubbed += domCount;
    }
  }

  fixHostRuntime();

  console.log(`Stubbed ${totalAwaitStubbed} top-level awaits total`);
  console.log(`Stubbed ${totalDomStubbed} DOM API functions total`);
}

/**
 * Main function to process all copy items
 */
function main(): void {
  console.log(
    'Starting copy process with dependency resolution and stubbing...'
  );
  console.log(`Source base: ${SOURCE_BASE}`);
  console.log(`Target base: ${TARGET_BASE}`);
  console.log('');

  // Clear processed files for fresh run
  processedFiles.clear();
  cssStubsGenerated.clear();
  generatedFileStubsGenerated.clear();
  thirdPartyDirsCopied.clear();

  // Ensure target base directory exists
  ensureDir(TARGET_BASE);

  // Process each copy item
  for (const item of COPY_LIST) {
    try {
      console.log(`\n--- Processing: ${item.source} ---`);
      processCopyItem(item);
    } catch (error) {
      console.error(`Error processing ${item.source}:`, error);
    }
  }

  // Post-process: stub top-level awaits and DOM API functions
  console.log('\n--- Post-processing lib files ---');
  postProcessLibFiles();

  console.log('');
  console.log(`Copy process completed!`);
  console.log(`- Processed ${processedFiles.size} files total`);
  console.log(`- Generated ${cssStubsGenerated.size} CSS stubs`);
  console.log(
    `- Generated ${generatedFileStubsGenerated.size} generated file stubs`
  );
  console.log(`- Copied ${thirdPartyDirsCopied.size} third-party directories`);
}

// Run the script if called directly
if (require.main === module) {
  main();
}

/**
 * Analyzes dependencies without copying them - useful for understanding what would be included
 */
function analyzeDependencies(
  filePath: string,
  excludeCategories: string[] = []
): {
  total: number;
  byCategory: Record<string, number>;
  excluded: string[];
  included: string[];
} {
  const dependencies = findDependencies(filePath, new Set(), excludeCategories);
  const excluded: string[] = [];
  const included: string[] = [];
  const byCategory: Record<string, number> = {};

  // Analyze all possible dependencies (without exclusions)
  const allDependencies = findDependencies(filePath, new Set(), []);

  for (const dep of allDependencies) {
    if (shouldExcludeDependency(dep, excludeCategories)) {
      excluded.push(dep);
    } else {
      included.push(dep);
    }

    // Categorize by path
    const parts = dep.split('/');
    const category = parts.slice(0, 2).join('/'); // e.g., "ui/legacy", "models/trace"
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  return {
    total: allDependencies.length,
    byCategory,
    excluded,
    included,
  };
}

export {
  main,
  COPY_LIST,
  processCopyItem,
  findDependencies,
  resolveImportPath,
  extractImports,
  generateCssStub,
  isCssImport,
  generateGeneratedFileStub,
  isGeneratedFileImport,
  copyThirdPartyDirectory,
  isThirdPartyDirectory,
  analyzeDependencies,
  shouldExcludeDependency,
  postProcessLibFiles,
  stubTopLevelAwaitInFile,
  stubDomFunctionsInFile,
  containsDomApiUsage,
};
