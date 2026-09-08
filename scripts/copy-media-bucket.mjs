#!/usr/bin/env node
/**
 * copy-media-bucket.mjs
 * ---------------------
 * `bun run copy-media-bucket --site <domain> --to <bucket> [--from <bucket>] [--apply]`
 *                            `[--repoint <base-url>]`
 *
 * Copies the R2 objects a site's CONTENT actually references from one bucket to
 * another. Use it when a site is pointed at a new bucket: the content files keep
 * only object keys, so repointing `business.technical.mediaBaseUrl` without
 * moving the objects leaves every photograph resolving to a 404 — and because
 * the build downloads and re-encodes each one, that is a failed build, not a
 * broken image.
 *
 * `--repoint` closes that trap: it writes the new base URL into the site
 * settings, but only after every object copied AND a sample of them came back
 * publicly readable from the new origin. Copy and switch in one command, or
 * nothing moves at all.
 *
 * It copies only what is referenced, not the whole bucket: a clone that shares
 * one photograph with its parent needs that photograph, and nothing else.
 *
 * Both notations are recognised, since a site can hold either:
 *   r2:photos/hero-3f2a9c1b.jpg          the uploader's sentinel form
 *   https://<base>/photos/hero-3f2a.jpg  what a CloudCannon R2 DAM writes
 *
 * Objects are streamed through a temp file with `wrangler r2 object get|put`,
 * so this works whether or not the source bucket is publicly readable, and
 * needs no S3 credentials beyond the wrangler login you already have.
 *
 * Dry run by default: it lists what would be copied and changes nothing.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--site') args.site = argv[++i];
    else if (arg === '--from') args.from = argv[++i];
    else if (arg === '--to') args.to = argv[++i];
    else if (arg === '--repoint') args.repoint = argv[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.site || !args.to) {
  console.error(
    'Usage: bun run copy-media-bucket --site <domain> --to <bucket> [--from <bucket>] [--apply]\n' +
      '\n' +
      '  --site   Site directory under sites/, e.g. acme.com\n' +
      '  --to     Destination R2 bucket name, e.g. cloudcannon-test\n' +
      '  --from   Source bucket name, e.g. acme-com-media\n' +
      '  --apply  Actually copy. Without it nothing is written.\n' +
      "  --repoint <base-url>  After a clean copy, point the site's\n" +
      '           mediaBaseUrl at this origin. Skipped if anything failed.'
  );
  process.exit(1);
}

const siteRoot = join(REPO_ROOT, 'sites', args.site);
const contentRoot = join(siteRoot, 'src', 'content');
const settingsPath = join(contentRoot, 'settings', 'site.json');

let settings;
try {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
} catch {
  console.error(`✗ could not read ${settingsPath} — is --site correct?`);
  process.exit(1);
}

const mediaBaseUrl = (settings.business?.technical?.mediaBaseUrl || '').replace(/\/+$/, '');

/**
 * Where the objects are read from.
 *
 * Two routes, and the HTTP one is preferred because it needs no bucket NAME —
 * a public origin says nothing about the bucket behind it, and guessing wrong
 * fails 49 times in a row. `--from` is for a source bucket that is not publicly
 * readable, or one in a different account from the site's configured origin.
 */
const sourceBucket = args.from;
const readVia = sourceBucket ? 'wrangler' : 'http';

if (readVia === 'http' && !mediaBaseUrl) {
  console.error(
    "✗ nothing to read from: the site's mediaBaseUrl is unset, so there is no\n" +
      '  public origin to pull from. Pass --from <bucket> to read with wrangler.'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Collect the keys this site's content references
// ---------------------------------------------------------------------------
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const SENTINEL = /r2:([A-Za-z0-9/._-]+)/g;
const keys = new Set();

for (const file of walk(contentRoot)) {
  if (!['.json', '.md', '.mdx', '.yml', '.yaml'].includes(extname(file))) continue;
  const text = readFileSync(file, 'utf8');

  for (const match of text.matchAll(SENTINEL)) keys.add(match[1]);

  // Absolute URLs on the configured bucket — what a CloudCannon DAM writes.
  if (mediaBaseUrl) {
    const asUrl = new RegExp(
      `${mediaBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([A-Za-z0-9/._%-]+)`,
      'g'
    );
    for (const match of text.matchAll(asUrl)) {
      keys.add(decodeURIComponent(match[1].replace(/[?#].*$/, '')));
    }
  }
}

const sorted = [...keys].sort();

if (sorted.length === 0) {
  console.log(`No R2 objects referenced by sites/${args.site}. Nothing to copy.`);
  process.exit(0);
}

console.log(`${sorted.length} object(s) referenced by sites/${args.site}`);
console.log(`  read from: ${readVia === 'http' ? `${mediaBaseUrl} (public origin)` : `bucket ${sourceBucket}`}`);
console.log(`  write to:  bucket ${args.to}`);
console.log('');

if (!args.apply) {
  for (const key of sorted) console.log(`  would copy  ${key}`);
  console.log('\nDry run — nothing was written. Re-run with --apply to copy.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function wrangler(wranglerArgs) {
  return spawnSync('bunx', ['wrangler', ...wranglerArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true, // Windows needs it to resolve the bunx shim
  });
}

const scratch = mkdtempSync(join(tmpdir(), 'r2-copy-'));
let copied = 0;
const failures = [];

try {
  for (const [index, key] of sorted.entries()) {
    const position = `[${index + 1}/${sorted.length}]`;
    const local = join(scratch, 'object.bin');

    if (readVia === 'http') {
      const url = `${mediaBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        writeFileSync(local, Buffer.from(await res.arrayBuffer()));
      } catch (err) {
        failures.push({ key, stage: 'get', message: err.message });
        console.log(`${position} ✗ get  ${key}`);
        continue;
      }
    } else {
      const get = wrangler(['r2', 'object', 'get', `${sourceBucket}/${key}`, '--file', local, '--remote']);
      if (get.status !== 0) {
        failures.push({ key, stage: 'get', message: (get.stderr || get.stdout || '').trim() });
        console.log(`${position} ✗ get  ${key}`);
        continue;
      }
    }

    const contentType = MIME[extname(key).toLowerCase()];
    const put = wrangler([
      'r2',
      'object',
      'put',
      `${args.to}/${key}`,
      '--file',
      local,
      '--remote',
      ...(contentType ? ['--content-type', contentType] : []),
    ]);
    if (put.status !== 0) {
      failures.push({ key, stage: 'put', message: (put.stderr || put.stdout || '').trim() });
      console.log(`${position} ✗ put  ${key}`);
      continue;
    }

    copied += 1;
    console.log(`${position} ✓ ${key}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('');
console.log(`✓ copied ${copied}/${sorted.length} object(s) to ${args.to}`);

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const failure of failures) {
    console.log(`  ${failure.stage}  ${failure.key}`);
    if (failure.message) console.log(`      ${failure.message.split('\n')[0]}`);
  }
  console.log(
    '\nThe site build downloads every referenced object, so it will fail while\n' +
      'any of these are missing. Fix them before repointing mediaBaseUrl.'
  );
  process.exit(1);
}

if (!args.repoint) {
  console.log(
    `\nNext: set business.technical.mediaBaseUrl in\n` +
      `  sites/${args.site}/src/content/settings/site.json\n` +
      `to the public origin of ${args.to}, and make the DAM's Base URL match.\n` +
      `Re-run with --repoint <base-url> to have that done for you.`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Repoint — only once the new origin is proven to serve what we just copied
// ---------------------------------------------------------------------------
const newBase = args.repoint.replace(/\/+$/, '');

// A bucket with no public access enabled answers 404 for everything, which
// looks exactly like a failed copy. Sampling a few real keys tells the two
// apart before the settings change makes it the build's problem.
const sample = sorted.slice(0, 3);
console.log(`\nVerifying ${sample.length} object(s) are public at ${newBase} …`);

const unreachable = [];
for (const key of sample) {
  const url = `${newBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    console.log(`  ${res.ok ? '✓' : '✗'} ${res.status}  ${key}`);
    if (!res.ok) unreachable.push(key);
  } catch (err) {
    console.log(`  ✗ ${err.message}  ${key}`);
    unreachable.push(key);
  }
}

if (unreachable.length) {
  console.error(
    `\n✗ ${newBase} did not serve ${unreachable.length} of ${sample.length} sampled object(s).\n` +
      '  mediaBaseUrl was NOT changed — the build would have failed.\n' +
      "  Check the bucket's public access (r2.dev enabled, or the custom domain live)."
  );
  process.exit(1);
}

settings.business.technical.mediaBaseUrl = newBase;
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

console.log(
  `\n✓ mediaBaseUrl set to ${newBase}\n` +
    `  in sites/${args.site}/src/content/settings/site.json\n` +
    `\nSet the same origin as the Base URL of the DAM in CloudCannon\n` +
    `(Site Settings -> Assets), then rebuild.`
);
