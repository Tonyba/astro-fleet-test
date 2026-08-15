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
import { execFileSync } from 'node:child_process';
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

/** The bucket this site writes to, straight from the binding it deploys with. */
/**
 * The bucket's public origin, from the same CMS setting the site builds against.
 * Used to ask "is this object already there?" over plain HTTP — which is both
 * cheaper than a wrangler process per file and a better question, since it
 * tests exactly what the build and the browser will do.
 */
function publicBase() {
  if (env.PUBLIC_MEDIA_BASE_URL) return env.PUBLIC_MEDIA_BASE_URL.replace(/\/+$/, '');
  const settings = join(siteDir, 'src', 'content', 'settings', 'site.json');
  if (!existsSync(settings)) return undefined;
  const url = JSON.parse(readFileSync(settings, 'utf8'))?.business?.technical?.mediaBaseUrl;
  return url ? String(url).replace(/\/+$/, '') : undefined;
}

const PUBLIC_BASE = publicBase();

/** True when the key is already readable at the public URL. */
async function existsInBucket(key) {
  if (!PUBLIC_BASE) return false;
  try {
    const response = await fetch(
      `${PUBLIC_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'HEAD' }
    );
    return response.ok;
  } catch {
    return false;
  }
}

function bucketName() {
  if (env.R2_BUCKET) return env.R2_BUCKET;
  const config = join(siteDir, 'wrangler.jsonc');
  if (existsSync(config)) {
    // Matched rather than parsed: the file is JSONC, and one field is all we want.
    const match = /"bucket_name"\s*:\s*"([^"]+)"/.exec(readFileSync(config, 'utf8'));
    if (match) return match[1];
  }
  return undefined;
}

const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/**
 * Uploads through the wrangler CLI, using whatever account auth wrangler
 * already has. This is the path that needs no new credentials — creating an R2
 * API token just to run a one-off migration is a step worth not asking for.
 *
 * Invoked as `node .../wrangler.js` rather than through bunx/npx so there is no
 * .cmd shim, no shell, and no quoting to get wrong on Windows.
 */
function wranglerUploader(bucket) {
  return {
    kind: 'wrangler',
    put(key, path, contentType) {
      execFileSync(
        process.execPath,
        [
          WRANGLER, 'r2', 'object', 'put', `${bucket}/${key}`,
          '--file', path,
          '--content-type', contentType,
          '--remote',
        ],
        { cwd: ROOT, stdio: 'pipe' }
      );
    },
  };
}

/** S3 API — faster (no process per file), but needs an R2 API token. */
function s3Uploader(bucket) {
  const store = s3Store({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket,
    endpoint: env.R2_ENDPOINT,
  });
  return {
    kind: 's3',
    async put(key, path, contentType) {
      await store.put(key, readFileSync(path), contentType);
    },
  };
}

function resolveUploader() {
  const bucket = bucketName();
  if (!bucket) {
    console.error(
      `No bucket for ${site}: add an r2_buckets entry to sites/${site}/wrangler.jsonc, ` +
        'or set R2_BUCKET.'
    );
    process.exit(1);
  }

  const hasS3 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].every((k) => env[k]);
  if (hasS3) return { bucket, ...s3Uploader(bucket) };

  if (!existsSync(WRANGLER)) {
    console.error(
      'No R2 credentials and no wrangler. Either run `bun install`, or put ' +
        `R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in sites/${site}/.env.`
    );
    process.exit(1);
  }
  return { bucket, ...wranglerUploader(bucket) };
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
const uploader = resolveUploader();
console.log(`uploading to ${uploader.bucket} via ${uploader.kind}\n`);

let uploaded = 0;
let skipped = 0;
for (const item of plan) {
  // Keys are content-addressed, so an object that is already there is already
  // correct. Skipping it makes a repeat run (the usual reason being a first
  // pass without --delete-local) cost a HEAD request instead of a re-upload.
  if (await existsInBucket(item.key)) {
    item.confirmed = true;
    skipped += 1;
  } else {
    const extension = extname(item.path).slice(1).toLowerCase().replace('jpeg', 'jpg');
    await uploader.put(item.key, item.path, CONTENT_TYPES[extension] ?? 'application/octet-stream');
    item.confirmed = true;
    uploaded += 1;
  }
  process.stdout.write(`\r${uploaded} uploaded, ${skipped} already present (${uploaded + skipped}/${plan.length})`);
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
  const keptForCode = [];
  const keptUnconfirmed = [];

  for (const item of plan) {
    // A file referenced only by content is safe now that content has been
    // rewritten, but one named in code would break the build.
    if (item.usedInCode.length > 0) {
      keptForCode.push(item);
      continue;
    }
    // Deleting the only copy on the strength of "the upload call returned" is
    // not good enough. Ask the public URL — the same fetch the build will make
    // — and keep anything that does not answer.
    if (!(await existsInBucket(item.key))) {
      keptUnconfirmed.push(item);
      continue;
    }
    unlinkSync(item.path);
    removed += 1;
  }

  console.log(`removed ${removed} local file(s)`);

  if (keptForCode.length) {
    console.log(
      `\nKept ${keptForCode.length} file(s) still named in code — change the default, then delete:`
    );
    for (const item of keptForCode) {
      console.log(
        `  ${relative(siteDir, item.path).split(sep).join('/')} <- ${item.usedInCode
          .map((file) => relative(ROOT, file).split(sep).join('/'))
          .join(', ')}`
      );
    }
  }

  if (keptUnconfirmed.length) {
    console.log(
      `\n::warning:: kept ${keptUnconfirmed.length} file(s) the bucket did not serve back. ` +
        (PUBLIC_BASE
          ? 'Re-run to retry the upload.'
          : 'No Media Bucket URL is set for this site, so nothing could be confirmed.')
    );
    for (const item of keptUnconfirmed) {
      console.log(`  ${relative(siteDir, item.path).split(sep).join('/')}`);
    }
  }
}

console.log(
  '\nDone. Set business.technical.mediaBaseUrl in the site settings to the bucket\'s public ' +
    'origin, then rebuild.\n'
);
