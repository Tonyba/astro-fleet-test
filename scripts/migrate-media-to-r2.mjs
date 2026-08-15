#!/usr/bin/env node
/**
 * migrate-media-to-r2.mjs
 * -----------------------
 * Moves a site's committed photographs into its R2 bucket and rewrites every
 * content reference from `/src/assets/...` to `r2:<key>`.
 *
 * This is the one-off half of the R2 change: `r2Image` handles everything
 * uploaded from now on, and this handles the 26 MB per site that was already
 * there. It produces exactly the keys the uploader would have produced —
 * `<prefix>/<slug>-<content-hash>.<ext>` — so a photo migrated today and the
 * same photo re-uploaded tomorrow land on the same object.
 *
 *   node scripts/migrate-media-to-r2.mjs --site test-2.com              # dry run
 *   node scripts/migrate-media-to-r2.mjs --site test-2.com --apply
 *   node scripts/migrate-media-to-r2.mjs --site test-2.com --apply --delete-local
 *
 * DRY RUN IS THE DEFAULT and prints the full plan: every file, the key it will
 * take, and every content reference that will change. Nothing is written to the
 * bucket or to disk without `--apply`.
 *
 * `--delete-local` removes the migrated file from src/assets afterwards, but
 * only when nothing outside the content tree still points at it. Several
 * shared-ui components carry `/src/assets/...` defaults in their props; the
 * file behind one of those is reported and kept rather than deleted out from
 * under the code.
 *
 * ICONS ARE NOT TOUCHED. public/media stays in the repo by design — see the
 * media section of the site's keystatic.config.ts.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { s3Store } from '../packages/shared-ui/src/media/r2-client.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};

const site = option('site');
const apply = flag('apply');
const deleteLocal = flag('delete-local');

if (!site) {
  console.error('Usage: node scripts/migrate-media-to-r2.mjs --site <domain> [--apply] [--delete-local]');
  process.exit(1);
}

const siteDir = join(ROOT, 'sites', site);
if (!existsSync(siteDir)) {
  console.error(`No such site: sites/${site}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Credentials — the site's .env, then the environment
// ---------------------------------------------------------------------------
/** Minimal .env reader; this script is the only place in the repo that needs one. */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnvFile(join(siteDir, '.env')), ...process.env };

function requireCredentials() {
  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter(
    (key) => !env[key]
  );
  if (missing.length) {
    console.error(
      `Missing ${missing.join(', ')} — put them in sites/${site}/.env (see .env.example) ` +
        'or export them. A dry run needs no credentials.'
    );
    process.exit(1);
  }
  return s3Store({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    endpoint: env.R2_ENDPOINT,
  });
}

// ---------------------------------------------------------------------------
// Key derivation — must match media-api.ts exactly
// ---------------------------------------------------------------------------
function slugifyName(name) {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'image'
  );
}

function keyFor(absolutePath, bytes) {
  // src/assets/photos/about/team.jpg -> photos/about, team-1a2b3c4d.jpg
  const rel = relative(join(siteDir, 'src', 'assets'), absolutePath).split(sep).join('/');
  const prefix = rel.split('/').slice(0, -1).join('/');
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const extension = extname(absolutePath).slice(1).toLowerCase().replace('jpeg', 'jpg');
  return `${prefix ? `${prefix}/` : ''}${slugifyName(basename(absolutePath))}-${hash}.${extension}`;
}

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------
function walk(dir, match, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, match, found);
    else if (match(path)) found.push(path);
  }
  return found;
}

const assets = walk(join(siteDir, 'src', 'assets'), (path) =>
  RASTER.has(extname(path).toLowerCase())
);

if (!assets.length) {
  console.log(`sites/${site}/src/assets holds no photographs — nothing to migrate.`);
  process.exit(0);
}

// Content files hold the references; .md carries them in frontmatter.
const contentFiles = walk(join(siteDir, 'src', 'content'), (path) =>
  /\.(json|md|mdx|ya?ml)$/i.test(path)
);

// Everything else that could name an asset path: component defaults, page
// props, lib config. Only consulted to decide whether deleting a file is safe.
const codeFiles = [
  ...walk(join(siteDir, 'src'), (path) => /\.(astro|ts|tsx|js|mjs)$/i.test(path)),
  ...walk(join(ROOT, 'packages'), (path) => /\.(astro|ts|tsx|js|mjs)$/i.test(path)),
];

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
/** Every spelling of a path that could appear in a content file. */
function referenceForms(absolutePath) {
  const rel = relative(join(siteDir, 'src', 'assets'), absolutePath).split(sep).join('/');
  return [`/src/assets/${rel}`, `src/assets/${rel}`, `@assets/${rel}`, `~/assets/${rel}`];
}

// Read each file once rather than once per asset: this is a few hundred assets
// against a few hundred files, and the naive nesting is tens of thousands of
// reads for no reason.
const contentSources = new Map(contentFiles.map((file) => [file, readFileSync(file, 'utf8')]));
const codeSources = new Map(codeFiles.map((file) => [file, readFileSync(file, 'utf8')]));

const plan = [];
let totalBytes = 0;

for (const path of assets) {
  const bytes = readFileSync(path);
  const key = keyFor(path, bytes);
  const forms = referenceForms(path);

  const usedInContent = [...contentSources]
    .filter(([, source]) => forms.some((form) => source.includes(`"${form}"`)))
    .map(([file]) => file);
  const usedInCode = [...codeSources]
    .filter(([, source]) => forms.some((form) => source.includes(form)))
    .map(([file]) => file);

  totalBytes += bytes.length;
  plan.push({ path, key, bytes, forms, usedInContent, usedInCode });
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

console.log(`\n${apply ? 'Migrating' : 'DRY RUN —'} ${plan.length} images (${megabytes(totalBytes)}) for ${site}\n`);

for (const item of plan) {
  const where = [
    item.usedInContent.length ? `${item.usedInContent.length} content` : '',
    item.usedInCode.length ? `${item.usedInCode.length} code` : '',
  ]
    .filter(Boolean)
    .join(', ');
  console.log(
    `  ${relative(siteDir, item.path).split(sep).join('/')}\n` +
      `    -> r2:${item.key}  (${megabytes(item.bytes.length)}${where ? `, referenced in ${where}` : ', unreferenced'})`
  );
}

if (!apply) {
  const rewrites = plan.reduce((sum, item) => sum + item.usedInContent.length, 0);
  console.log(
    `\nWould upload ${plan.length} objects and rewrite ${rewrites} content reference(s).` +
      `\nRe-run with --apply to do it${deleteLocal ? ', --delete-local also removes the originals' : ''}.\n`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
const store = requireCredentials();

let uploaded = 0;
for (const item of plan) {
  const extension = extname(item.path).slice(1).toLowerCase().replace('jpeg', 'jpg');
  await store.put(item.key, item.bytes, CONTENT_TYPES[extension] ?? 'application/octet-stream');
  uploaded += 1;
  process.stdout.write(`\ruploaded ${uploaded}/${plan.length}`);
}
process.stdout.write('\n');

// Rewrite references. Done after every upload succeeds, so a failure part-way
// through leaves the repo pointing at files that are still there.
let rewritten = 0;
for (const [file, before] of contentSources) {
  let source = before;
  for (const item of plan) {
    for (const form of item.forms) {
      // Quoted, so a path is only replaced when it is the whole value.
      source = source.split(`"${form}"`).join(`"r2:${item.key}"`);
    }
  }
  if (source !== before) {
    writeFileSync(file, source);
    rewritten += 1;
  }
}
console.log(`rewrote ${rewritten} content file(s)`);

if (deleteLocal) {
  let removed = 0;
  const kept = [];
  for (const item of plan) {
    // Re-read: a file referenced only by content is safe now that content has
    // been rewritten, but one named in code would break the build.
    const stillReferenced = item.usedInCode.length > 0;
    if (stillReferenced) {
      kept.push(item);
      continue;
    }
    unlinkSync(item.path);
    removed += 1;
  }
  console.log(`removed ${removed} local file(s)`);
  if (kept.length) {
    console.log(
      `\nKept ${kept.length} file(s) still named in code — change the default, then delete:`
    );
    for (const item of kept) {
      console.log(
        `  ${relative(siteDir, item.path).split(sep).join('/')} <- ${item.usedInCode
          .map((file) => relative(ROOT, file).split(sep).join('/'))
          .join(', ')}`
      );
    }
  }
}

console.log(
  '\nDone. Set business.technical.mediaBaseUrl in the site settings to the bucket\'s public ' +
    'origin, then rebuild.\n'
);
