#!/usr/bin/env node
/**
 * check-file-sizes.mjs
 * --------------------
 * Build/CI guard over every file in the repository — and in a built `dist/` —
 * that exceeds the size budget. What happens next depends on what the file is:
 *
 *   images          → hard failure (exit 1)
 *   everything else → warning only (exit 0)
 *
 * The budget exists to keep unprocessed photography out of the repo and out of
 * what visitors download. Every photograph enters through
 * `scripts/import-photo.mjs`, which downscales and re-encodes it well under the
 * budget; a multi-megabyte Figma PNG dropped straight into `src/assets` or
 * `public/` fails this guard instead of shipping, and
 * `scripts/optimize-images.mjs` repairs it.
 *
 * A large JS bundle is a different kind of problem with a different fix, and
 * this was never the right place to block it — the Keystatic admin bundle only
 * CMS editors load, and Worker code never reaches a browser at all. Those used
 * to need a hand-maintained exemption list, and every future one would have
 * needed adding to it. Warning instead keeps them visible without blocking a
 * build over a judgement this script is not equipped to make.
 *
 * Usage:
 *   node scripts/check-file-sizes.mjs [--limit 1MB] [path...]
 */
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** 1 MB: enforced on images, advisory on everything else. */
const DEFAULT_LIMIT = 1024 * 1024;

/**
 * What counts as an image, and so what this guard actually FAILS on.
 * Deliberately wider than the raster formats `optimize-images.mjs` can
 * re-encode: an oversized SVG or animated GIF is still a problem worth failing
 * on, it just needs a human rather than sharp.
 */
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif',
  '.svg', '.ico', '.bmp', '.tif', '.tiff', '.heic', '.heif',
]);

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

/** Over budget and an image — these fail the build. */
const oversized = [];
/** Over budget and not an image — these are reported and forgiven. */
const oversizedOther = [];

let scanned = 0;
let images = 0;

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

    // Repo-relative where that means something, absolute when a scan was
    // pointed outside the repo — a wall of `../../..` helps nobody.
    const fromRoot = relative(REPO_ROOT, full).split(sep).join('/');
    const rel = fromRoot.startsWith('../') ? full.split(sep).join('/') : fromRoot;

    const isImage = IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase());
    const { size } = await stat(full);

    scanned++;
    if (isImage) images++;
    if (size <= limit) continue;

    (isImage ? oversized : oversizedOther).push({ file: rel, size });
  }
}

for (const root of roots) await walk(root);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const listing = (entries) =>
  entries
    .sort((a, b) => b.size - a.size)
    .map(({ file, size }) => `  ${mb(size).padStart(9)}  ${file}`)
    .join('\n');

// ---------------------------------------------------------------------------
// GitHub Actions annotations
// ---------------------------------------------------------------------------
// A line buried in a step log is a warning nobody reads. On a runner, emit the
// same findings as workflow commands so they surface on the run summary and,
// for a file in the diff, inline on the pull request. Locally these would just
// be noise on top of the listing above, so they only fire in Actions.
const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

/** Escaping required by GitHub's workflow-command format. */
const escapeData = (value) =>
  String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = (value) =>
  escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * GitHub renders at most 10 annotations of each level per step, so cap the
 * list rather than emitting 40 commands and silently losing 30 of them.
 */
const MAX_ANNOTATIONS = 10;

function annotate(level, entries, title, describe) {
  if (!IN_ACTIONS || entries.length === 0) return;

  for (const entry of entries.slice(0, MAX_ANNOTATIONS)) {
    // `file=` must be workspace-relative; an absolute path (a scan pointed
    // outside the repo) cannot be anchored, so annotate it without one.
    const anchor = /^([a-zA-Z]:)?\//.test(entry.file) ? '' : `file=${escapeProp(entry.file)},`;
    console.log(
      `::${level} ${anchor}title=${escapeProp(title)}::${escapeData(describe(entry))}`
    );
  }

  const dropped = entries.length - MAX_ANNOTATIONS;
  if (dropped > 0) {
    console.log(
      `::notice::${dropped} further ${level}(s) not annotated — GitHub shows ` +
        `${MAX_ANNOTATIONS} per step. The step log lists all of them.`
    );
  }
}

// Non-images first, so that when the build is about to fail the image list is
// the last thing left on screen.
if (oversizedOther.length > 0) {
  console.warn(
    `\n⚠ ${oversizedOther.length} non-image file(s) over the ${mb(limit)} budget ` +
      `— warning only:\n\n${listing(oversizedOther)}\n\n` +
      '  Not enforced: this budget is about unprocessed photography, and a code\n' +
      '  bundle is a different problem with a different fix. Worth a look if one\n' +
      '  of these grew unexpectedly.\n'
  );

  annotate(
    'warning',
    oversizedOther,
    `Over the ${mb(limit)} file budget`,
    ({ file, size }) =>
      `${file} is ${mb(size)}, over the ${mb(limit)} budget. Not enforced — ` +
      `only images fail this check — but worth a look if it grew unexpectedly.`
  );
}

if (oversized.length > 0) {
  console.error(`\n✗ ${oversized.length} image(s) exceed the ${mb(limit)} budget:\n`);
  console.error(listing(oversized));
  console.error(
    '\nRe-encode oversized photographs in place (renames and rewrites references):\n' +
      '  bun run optimize:images\n' +
      '\nOr import a new photograph through the pipeline:\n' +
      '  node scripts/import-photo.mjs <file> --out sites/<domain>/src/assets/photos\n'
  );

  // The optimizer re-encodes raster photographs. Anything else on the list is
  // over budget for a reason no automated pass should paper over.
  const manual = oversized.filter(({ file }) => /\.(svg|gif|ico)$/i.test(file));
  if (manual.length > 0) {
    console.error(
      'These are not raster photographs, so `optimize:images` will not touch them —\n' +
        'simplify or redraw them by hand:\n' +
        manual.map(({ file }) => `  ${file}`).join('\n') +
        '\n'
    );
  }

  // The same list as an error annotation, so a failed run names the offending
  // file on the summary instead of only inside the step log.
  const manualPaths = new Set(manual.map(({ file }) => file));
  annotate(
    'error',
    oversized,
    `Image over the ${mb(limit)} budget`,
    ({ file, size }) =>
      `${file} is ${mb(size)}, over the ${mb(limit)} budget. ` +
      (manualPaths.has(file)
        ? 'Not a raster photograph, so `bun run optimize:images` cannot fix it — simplify or redraw it by hand.'
        : 'Run `bun run optimize:images` to re-encode it in place.')
  );

  process.exit(1);
}

console.log(
  `✓ ${images} image(s) scanned (of ${scanned} file(s)), none over the ${mb(limit)} budget.`
);
