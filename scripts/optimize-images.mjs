#!/usr/bin/env node
/**
 * optimize-images.mjs
 * -------------------
 * Self-healing counterpart to `check-file-sizes.mjs`.
 *
 * `import-photo.mjs` is the front door for photographs a DEVELOPER adds. It is
 * not the only door: /keystatic uploads land in `src/assets/` (and `public/`)
 * at whatever size the editor's camera produced, and in production Keystatic
 * commits them straight to `main` without this machine ever seeing them. Those
 * uploads are what trip the 1 MB budget in CI.
 *
 * This script closes that gap. It walks the source tree, finds raster images
 * over the budget, and re-encodes them IN PLACE with the same rules
 * `import-photo.mjs` applies — stepping quality and width down a ladder until
 * the file fits. When the right format is not the one that was uploaded (a
 * photographic PNG becomes a JPEG), the file is renamed AND every reference to
 * the old path inside the owning site is rewritten, so no content entry is left
 * pointing at a file that no longer exists.
 *
 * Idempotent: a second run finds nothing to do.
 *
 * Usage:
 *   node scripts/optimize-images.mjs [--check] [--budget 1MB] [--max-width 1920] [path...]
 *
 *   --check                 report what would change and exit 1; write nothing
 *   --changed-list <file>   write every path this run created, deleted or
 *                           edited, one per line (the pre-commit hook stages
 *                           exactly these and nothing else)
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { hasMeaningfulAlpha } from './import-photo.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Must match `check-file-sizes.mjs` — this script exists to satisfy that guard. */
const DEFAULT_BUDGET = 1024 * 1024;
const DEFAULT_MAX_WIDTH = 1920;

/**
 * A lossless PNG bigger than this is a photograph wearing a cut-out rather than
 * flat art — same threshold `import-photo.mjs` uses to switch it to lossy WebP.
 */
const WEBP_ABOVE = 500 * 1024;

/**
 * Width/quality steps tried in order; the first result under budget wins. The
 * top rung is exactly what `import-photo.mjs` produces, so an image that came
 * in through the front door is already at rung 0 and is never touched.
 */
const LADDER = [
  { width: 1920, quality: 90 },
  { width: 1920, quality: 82 },
  { width: 1600, quality: 80 },
  { width: 1440, quality: 78 },
  { width: 1280, quality: 75 },
];

const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.tif', '.tiff']);

/** Files whose text may hold a path to a renamed image. */
const TEXT = new Set([
  '.json', '.yaml', '.yml', '.md', '.mdx', '.mdoc', '.astro',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.txt',
]);

/**
 * Never walked. `dist/` is on the list because build output is regenerated from
 * the sources this script fixes — optimising it would be thrown away.
 */
const SKIP_DIRS = new Set([
  '.git', '.astro', '.turbo', '.wrangler', '.vercel', '.netlify', 'node_modules', 'dist',
]);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let budget = DEFAULT_BUDGET;
let maxWidth = DEFAULT_MAX_WIDTH;
let checkOnly = false;
let changedList = null;
const roots = [];

/** Every path this run created, deleted or edited. */
const changed = new Set();

const parseSize = (raw) => {
  const match = /^(\d+(?:\.\d+)?)(kb|mb|b)?$/i.exec(raw ?? '');
  if (!match) {
    console.error(`Unrecognised size value: ${raw}`);
    process.exit(2);
  }
  const scale = { b: 1, kb: 1024, mb: 1024 * 1024 }[(match[2] ?? 'b').toLowerCase()];
  return Number(match[1]) * scale;
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') checkOnly = true;
  else if (args[i] === '--changed-list') changedList = resolve(args[++i]);
  else if (args[i] === '--budget') budget = parseSize(args[++i]);
  else if (args[i] === '--max-width') maxWidth = Number(args[++i]);
  else if (args[i].startsWith('-')) {
    // `bun run build --filter=<site>` forwards turbo's flags to every script in
    // the chain. Treating `--filter=…` as a path to scan would silently turn
    // this into a no-op, so ignore what we do not own — loudly.
    console.warn(`(ignoring unrecognised option ${args[i]})`);
  } else roots.push(resolve(args[i]));
}

if (roots.length === 0) roots.push(REPO_ROOT);

for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`✗ Path to scan does not exist: ${relative(REPO_ROOT, root) || root}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------
const toPosix = (p) => p.split(sep).join('/');

/**
 * Repo-relative POSIX path, or `null` when the file sits outside the repo — a
 * scan can be pointed anywhere, and a path that escapes the root has no
 * meaningful references to rewrite.
 */
function repoPath(abs) {
  const rel = toPosix(relative(REPO_ROOT, abs));
  return rel.startsWith('../') ? null : rel;
}

/** What the user sees: repo-relative inside the repo, absolute outside it. */
const display = (abs) => repoPath(abs) ?? toPosix(abs);

async function walk(dir, onFile) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, onFile);
    } else if (entry.isFile()) {
      await onFile(full, entry.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Reference rewriting
// ---------------------------------------------------------------------------
/**
 * The substring every reference to an image shares, whichever form it takes.
 *
 * Keystatic writes `/src/assets/photos/a/b.png`, an Astro import writes
 * `../assets/photos/a/b.png`, and a public file is `/media/icons/c.png`.
 * Dropping everything up to and including the `src/` or `public/` segment
 * leaves `assets/photos/a/b.png` / `media/icons/c.png`, which all three contain
 * and which is unique inside the site that owns the file.
 */
function referenceKey(repoRelPath) {
  const match = /(?:^|\/)(?:src|public)\/(.+)$/.exec(repoRelPath);
  return match ? match[1] : repoRelPath;
}

/**
 * The directory whose text files may reference this image. Scoped to the owning
 * site so two sites holding `assets/photos/hero/image.png` cannot rewrite each
 * other's content.
 */
function referenceScope(repoRelPath) {
  const match = /^(sites\/[^/]+|packages\/[^/]+)\//.exec(repoRelPath);
  return match ? resolve(REPO_ROOT, match[1]) : REPO_ROOT;
}

const textFileCache = new Map();

async function textFilesUnder(dir) {
  if (textFileCache.has(dir)) return textFileCache.get(dir);
  const files = [];
  await walk(dir, (full, name) => {
    if (TEXT.has(extname(name).toLowerCase())) files.push(full);
  });
  textFileCache.set(dir, files);
  return files;
}

/** Replace `from` with `to` in every text file under `scope`. Literal, not regex. */
async function rewriteReferences(scope, from, to) {
  const touched = [];
  for (const file of await textFilesUnder(scope)) {
    const before = await readFile(file, 'utf8');
    if (!before.includes(from)) continue;
    await writeFile(file, before.split(from).join(to), 'utf8');
    const rel = toPosix(relative(REPO_ROOT, file));
    changed.add(rel);
    touched.push(rel);
  }
  return touched;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------
async function encode(src, tmp, format, width, quality) {
  let pipeline = sharp(src, { limitInputPixels: false })
    .rotate() // honour EXIF orientation before the metadata is dropped
    .resize({ width, withoutEnlargement: true });

  if (format === 'jpeg') {
    pipeline = pipeline
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' });
  } else if (format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9, effort: 10 }); // lossless
  } else {
    pipeline = pipeline.webp({ quality, effort: 6, alphaQuality: 100 });
  }

  const info = await pipeline.toFile(tmp);
  const { size } = await stat(tmp);
  return { width: info.width, height: info.height, bytes: size };
}

/**
 * Re-encode one over-budget image in place.
 * @returns {Promise<{status: string, [k: string]: unknown}>}
 */
async function optimize(file, repoRel, originalBytes) {
  const meta = await sharp(file, { limitInputPixels: false }).metadata();

  // An animated GIF/WebP would be flattened to its first frame by the pipeline
  // below. Losing the animation silently is worse than failing the budget.
  if ((meta.pages ?? 1) > 1) return { status: 'animated' };

  const keepAlpha = await hasMeaningfulAlpha(file);
  const ceiling = Math.min(meta.width ?? maxWidth, maxWidth);
  const tmp = `${file}.opt-tmp`;

  // Same format decision as import-photo.mjs: opaque art becomes a JPEG; real
  // transparency stays lossless PNG unless that PNG is photograph-sized, in
  // which case lossy WebP keeps the alpha without the weight.
  let attempts;
  if (keepAlpha) {
    const png = await encode(file, tmp, 'png', ceiling, 100);
    if (png.bytes <= WEBP_ABOVE) attempts = [{ format: 'png', ...png }];
    else attempts = null; // fall through to the WebP ladder
  }

  if (!attempts) {
    const format = keepAlpha ? 'webp' : 'jpeg';
    let best = null;
    for (const rung of LADDER) {
      const width = Math.min(ceiling, rung.width);
      const result = await encode(file, tmp, format, width, rung.quality);
      best = { format, ...result, quality: rung.quality };
      if (result.bytes <= budget) break;
    }
    attempts = [best];
  }

  const chosen = attempts[0];
  const ext = chosen.format === 'jpeg' ? '.jpg' : `.${chosen.format}`;
  const target = join(dirname(file), `${basename(file, extname(file))}${ext}`);
  const renaming = resolve(target) !== resolve(file);

  // Nothing gained: the upload was already the best encoding of itself. Leave
  // it alone so `check:sizes` reports it honestly instead of us shipping a
  // re-encode that is no smaller.
  if (chosen.bytes >= originalBytes && !renaming) {
    await unlink(tmp);
    return { status: 'incompressible', bytes: chosen.bytes };
  }

  // Renaming onto a file that already exists would destroy it — and whatever
  // still points at it. Rare (Keystatic deletes the file it replaces), but
  // unrecoverable, so stop and say what to remove.
  if (renaming && existsSync(target)) {
    await unlink(tmp);
    return { status: 'collision', target: display(target) };
  }

  await rename(tmp, target);
  if (renaming) await unlink(file);

  const targetRel = repoPath(target);
  if (targetRel) changed.add(targetRel);
  if (renaming && repoRel) changed.add(repoRel);

  // Only files inside the repo can have references worth chasing.
  let rewrote = [];
  if (renaming && repoRel && targetRel) {
    rewrote = await rewriteReferences(
      referenceScope(repoRel),
      referenceKey(repoRel),
      referenceKey(targetRel)
    );
  }

  return {
    status: chosen.bytes <= budget ? 'ok' : 'still-over',
    target: display(target),
    bytes: chosen.bytes,
    width: chosen.width,
    height: chosen.height,
    format: chosen.format,
    rewrote,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const oversized = [];

for (const root of roots) {
  await walk(root, async (full, name) => {
    if (!RASTER.has(extname(name).toLowerCase())) return;
    const { size } = await stat(full);
    if (size > budget) oversized.push({ file: full, size });
  });
}

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/**
 * Always written when asked for, even when empty — a consumer that reads it
 * unconditionally should not have to tell "nothing changed" apart from "the run
 * died before it got here".
 */
async function emitChangedList() {
  if (!changedList) return;
  await writeFile(changedList, [...changed].sort().join('\n') + (changed.size ? '\n' : ''), 'utf8');
}

if (oversized.length === 0) {
  console.log(`✓ No image over the ${mb(budget)} budget.`);
  await emitChangedList();
  process.exit(0);
}

oversized.sort((a, b) => b.size - a.size);

if (checkOnly) {
  console.error(`\n✗ ${oversized.length} image(s) over the ${mb(budget)} budget:\n`);
  for (const { file, size } of oversized) {
    console.error(`  ${mb(size).padStart(9)}  ${display(file)}`);
  }
  console.error('\nRun `bun run optimize:images` to re-encode them in place.\n');
  await emitChangedList();
  process.exit(1);
}

let failed = 0;

for (const { file, size } of oversized) {
  const repoRel = repoPath(file);
  const shown = display(file);
  let result;
  try {
    result = await optimize(file, repoRel, size);
  } catch (error) {
    console.error(`✗ ${shown}: ${error.message}`);
    failed++;
    continue;
  }

  if (result.status === 'ok' || result.status === 'still-over') {
    const arrow = result.target === shown ? '' : ` → ${result.target}`;
    console.log(
      `${result.status === 'ok' ? '✓' : '!'} ${shown}${arrow}  ` +
        `${mb(size)} → ${kb(result.bytes)}  (${result.width}×${result.height} ${result.format})`
    );
    for (const ref of result.rewrote) console.log(`    ↳ reference updated in ${ref}`);
    if (result.status === 'still-over') {
      console.error(`  ✗ still over budget at the lowest rung — needs a smaller source.`);
      failed++;
    }
  } else if (result.status === 'animated') {
    console.error(`✗ ${shown}: animated image, cannot be re-encoded without losing frames.`);
    failed++;
  } else if (result.status === 'incompressible') {
    console.error(`✗ ${shown}: already the smallest encoding of itself (${kb(result.bytes)}).`);
    failed++;
  } else if (result.status === 'collision') {
    console.error(
      `✗ ${shown}: wants to become ${result.target}, which already exists.\n` +
        `  Delete the unused one (check nothing references it first) and re-run.`
    );
    failed++;
  }
}

await emitChangedList();

if (failed > 0) {
  console.error(`\n✗ ${failed} image(s) could not be brought under the ${mb(budget)} budget.`);
  process.exit(1);
}

console.log(`\n✓ ${oversized.length} image(s) optimized.`);
