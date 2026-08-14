#!/usr/bin/env node
/**
 * check-file-sizes.mjs
 * --------------------
 * Build/CI guard: fails when any file in the repository — or in a built
 * `dist/` — exceeds the size budget.
 *
 * This is what keeps unprocessed photography out of the repo. Every photograph
 * enters through `scripts/import-photo.mjs`, which downscales and re-encodes it
 * well under the budget; a multi-megabyte Figma PNG dropped straight into
 * `src/assets` or `public/` trips this guard instead of shipping.
 *
 * Usage:
 *   node scripts/check-file-sizes.mjs [--limit 1MB] [path...]
 */
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** 1 MB, the hard ceiling for any single file we commit or ship. */
const DEFAULT_LIMIT = 1024 * 1024;

/**
 * Exempt from the budget. This guard exists to keep unprocessed PHOTOGRAPHY out
 * of the repo and out of what visitors download — it is not a general
 * code-splitting budget, so two kinds of build output are excluded:
 *
 *  1. The Keystatic admin bundle. `/keystatic` is a React application that only
 *     CMS editors ever load; it is not referenced by any rendered page.
 *  2. Server bundles. Worker code never reaches a browser, and Cloudflare
 *     enforces its own (much larger) limit on it at deploy time.
 *
 * Images are still checked everywhere, including inside `dist/`.
 */
const EXEMPT = [
  /\/dist\/client\/_astro\/KeystaticApp\.[\w-]+\.js$/,
  /\/dist\/server\//,
];

/** Never walked: tooling caches and installed dependencies are not ours. */
const SKIP_DIRS = new Set([
  '.git',
  '.astro',
  '.turbo',
  '.wrangler',
  '.vercel',
  '.netlify',
  'node_modules',
]);

const args = process.argv.slice(2);
let limit = DEFAULT_LIMIT;
const roots = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') {
    const raw = args[++i];
    const match = /^(\d+(?:\.\d+)?)(kb|mb|b)?$/i.exec(raw ?? '');
    if (!match) {
      console.error(`Unrecognised --limit value: ${raw}`);
      process.exit(2);
    }
    const scale = { b: 1, kb: 1024, mb: 1024 * 1024 }[(match[2] ?? 'b').toLowerCase()];
    limit = Number(match[1]) * scale;
  } else if (args[i].startsWith('-')) {
    // Flags meant for another tool. `bun run build --filter=<site>` forwards
    // turbo's flags to this script too, and treating `--filter=…` as a path to
    // scan silently turned the guard into a no-op ("0 file(s) scanned"). Ignore
    // anything we do not own rather than pretending to have checked it.
    console.warn(`(ignoring unrecognised option ${args[i]})`);
  } else {
    roots.push(resolve(args[i]));
  }
}

if (roots.length === 0) roots.push(REPO_ROOT);

// A path that does not exist can only mean a typo or a flag we failed to parse.
// Either way the scan would quietly cover nothing, so fail loudly instead.
for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`✗ Path to scan does not exist: ${relative(REPO_ROOT, root) || root}`);
    process.exit(2);
  }
}

const oversized = [];
let scanned = 0;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // nothing built here yet
  }

  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full);
      continue;
    }
    if (!entry.isFile()) continue;

    const rel = relative(REPO_ROOT, full).split(sep).join('/');
    if (EXEMPT.some((pattern) => pattern.test(`/${rel}`))) continue;

    const { size } = await stat(full);
    scanned++;
    if (size > limit) oversized.push({ file: rel, size });
  }
}

for (const root of roots) await walk(root);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

if (oversized.length > 0) {
  oversized.sort((a, b) => b.size - a.size);
  console.error(`\n✗ ${oversized.length} file(s) exceed the ${mb(limit)} budget:\n`);
  for (const { file, size } of oversized) console.error(`  ${mb(size).padStart(9)}  ${file}`);
  console.error(
    '\nPhotographs must be imported through the pipeline:\n' +
      '  node scripts/import-photo.mjs <file> --out sites/<domain>/src/assets/photos\n'
  );
  process.exit(1);
}

console.log(`✓ ${scanned} file(s) scanned, none over the ${mb(limit)} budget.`);
