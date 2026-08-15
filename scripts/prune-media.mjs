#!/usr/bin/env node
/**
 * prune-media.mjs
 * ---------------
 * Deletes objects in a site's R2 bucket that no content references any more.
 *
 *   bun run prune-media --site test-2.com                 # dry run
 *   bun run prune-media --site test-2.com --apply
 *
 * WHY THIS EXISTS RATHER THAN DELETING ON CLEAR. Clearing or replacing an image
 * in Keystatic deliberately leaves the object alone, because at that moment
 * nothing can safely be deleted:
 *
 *   - keys are content-addressed, so two entries may point at the SAME object;
 *     deleting when one clears would break the other. (Making shared images
 *     safe is half the point of storing them this way — see CLAUDE.md.)
 *   - clearing a field is not saving an entry. An editor who clears and then
 *     navigates away has destroyed nothing.
 *   - in GitHub mode an edit can live on an unmerged branch, so "no longer
 *     referenced on main" does not mean "no longer referenced".
 *
 * Sweeping afterwards has none of those problems: it can see every reference at
 * once. To cover the third case it reads content from EVERY branch tip, not
 * just the checkout, and refuses by default to touch anything uploaded in the
 * last few days — an object is uploaded seconds BEFORE the entry that
 * references it is saved, and a sweep run in that window would delete a live
 * image out from under an editor mid-edit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { s3Store } from '../packages/shared-ui/src/media/r2-client.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const site = option('site');
const apply = flag('apply');
/** Objects younger than this are never swept. */
const keepDays = Number(option('keep-days', '7'));

if (!site) {
  console.error(
    'Usage: node scripts/prune-media.mjs --site <domain> [--apply] [--keep-days N]'
  );
  process.exit(1);
}

const siteDir = join(ROOT, 'sites', site);
if (!existsSync(siteDir)) {
  console.error(`No such site: sites/${site}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Credentials — listing a bucket is the one thing wrangler cannot do
// ---------------------------------------------------------------------------
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// Account-wide credentials (CLOUDFLARE_*) belong to the fleet, not to one site,
// so a repo-root .env is read first and any site .env layers over it. Without
// this, "which site's .env did I put the account token in?" decides whether the
// command works.
const env = {
  ...loadEnvFile(join(ROOT, '.env')),
  ...loadEnvFile(join(siteDir, '.env')),
  ...process.env,
};

function bucketName() {
  if (env.R2_BUCKET) return env.R2_BUCKET;
  const config = join(siteDir, 'wrangler.jsonc');
  if (existsSync(config)) {
    const match = /"bucket_name"\s*:\s*"([^"]+)"/.exec(readFileSync(config, 'utf8'));
    if (match) return match[1];
  }
  return undefined;
}

const bucket = bucketName();
if (!bucket) {
  console.error(
    `No bucket for ${site}: add an r2_buckets entry to sites/${site}/wrangler.jsonc, ` +
      'or set R2_BUCKET.'
  );
  process.exit(1);
}

const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/**
 * Listing is the one operation wrangler cannot do (`r2 object` offers only
 * get/put/delete) — but Cloudflare's REST API can, with the same account token
 * that deploys the site. That is why this needs no R2-specific credentials:
 * list over REST, delete over wrangler. An R2 API token is still used when one
 * happens to be configured, since the S3 path is fewer round trips.
 */
async function listViaRestApi() {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) return undefined;

  const objects = [];
  let cursor;
  do {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects`
    );
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!body.success) {
      throw new Error(`R2 list failed: ${JSON.stringify(body.errors)}`);
    }
    objects.push(
      ...body.result.map((o) => ({ key: o.key, size: o.size, uploaded: o.last_modified }))
    );
    cursor = body.result_info?.is_truncated ? body.result_info.cursor : undefined;
  } while (cursor);

  return objects;
}

const hasS3 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].every((k) => env[k]);
const store = hasS3
  ? s3Store({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket,
      endpoint: env.R2_ENDPOINT,
    })
  : undefined;

async function listObjects() {
  if (store) return store.list('', 10000);
  const viaRest = await listViaRestApi();
  if (viaRest) return viaRest;
  console.error(
    'Cannot list the bucket. This needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID —\n' +
      'the same pair that deploys the site, not an R2-specific token. They are\n' +
      'account-wide, so the tidy home is a .env at the REPO ROOT (read by every\n' +
      `site); sites/${site}/.env and the environment also work.`
  );
  process.exit(1);
}

async function deleteObject(key) {
  if (store) return store.delete(key);
  execFileSync(
    process.execPath,
    [WRANGLER, 'r2', 'object', 'delete', `${bucket}/${key}`, '--remote'],
    { cwd: ROOT, stdio: 'pipe' }
  );
}

// ---------------------------------------------------------------------------
// Every key anything still points at
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

const KEY_PATTERN = /r2:([^"'\s\\]+)/g;

function keysIn(text, into) {
  for (const match of text.matchAll(KEY_PATTERN)) into.add(match[1]);
}

/** The working tree: content files plus anything in src that names a key. */
function referencedInCheckout() {
  const keys = new Set();
  const files = [
    ...walk(join(siteDir, 'src', 'content'), (p) => /\.(json|md|mdx|ya?ml)$/i.test(p)),
    ...walk(join(siteDir, 'src'), (p) => /\.(astro|ts|tsx|js|mjs)$/i.test(p)),
    ...walk(join(ROOT, 'packages'), (p) => /\.(astro|ts|tsx|js|mjs)$/i.test(p)),
  ];
  for (const file of files) keysIn(readFileSync(file, 'utf8'), keys);
  return keys;
}

/**
 * Every branch tip, local and remote. A Keystatic edit made against a branch is
 * a real reference even though it is not on main, and pruning its image would
 * break that entry the moment anyone opened it.
 */
function referencedInBranches() {
  const keys = new Set();
  let refs = [];
  try {
    refs = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    console.warn('  (not a git repo — checking the working tree only)');
    return keys;
  }

  for (const ref of refs) {
    try {
      const out = execFileSync(
        'git',
        ['grep', '-h', '-o', '-E', 'r2:[^"]+', ref, '--', `sites/${site}/src/content`],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      keysIn(out, keys);
    } catch {
      // git grep exits non-zero when a ref has no matches; nothing to do.
    }
  }
  return keys;
}

/**
 * A stale checkout is the one way this command can destroy live images.
 *
 * The CMS commits straight to the remote, so images uploaded through the
 * deployed admin are referenced by commits this clone may not have yet. Those
 * keys would look unreferenced, and pruning them would break pages that are
 * already published. Fetch first, and refuse to delete while behind.
 */
function checkFreshness() {
  try {
    execFileSync('git', ['fetch', '--quiet'], { cwd: ROOT, stdio: 'pipe' });
  } catch {
    console.warn('  (could not fetch — reference data may be stale)');
    return;
  }
  const behind = execFileSync('git', ['rev-list', '--count', '@{u}..HEAD', '--right-only'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const missing = Number(
    execFileSync('git', ['rev-list', '--count', 'HEAD..@{u}'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  );
  if (missing > 0) {
    console.error(
      `\nThis checkout is ${missing} commit(s) behind its upstream. The CMS commits\n` +
        'to the remote, so those commits may reference images that would look\n' +
        'unreferenced here. Pull first, then re-run.\n'
    );
    if (apply) process.exit(1);
    console.error('(continuing — dry run only)\n');
  }
  void behind;
}

checkFreshness();

const referenced = new Set([...referencedInCheckout(), ...referencedInBranches()]);

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
const objects = await listObjects();
const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;

const orphans = [];
const tooYoung = [];
for (const object of objects) {
  if (referenced.has(object.key)) continue;
  const uploaded = object.uploaded ? Date.parse(object.uploaded) : 0;
  if (uploaded && uploaded > cutoff) tooYoung.push(object);
  else orphans.push(object);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const total = (list) => list.reduce((sum, o) => sum + o.size, 0);

console.log(`\n${site} -> ${bucket}`);
console.log(`  ${objects.length} objects, ${referenced.size} keys referenced by content or code`);
console.log(`  ${orphans.length} unreferenced (${mb(total(orphans))})`);
if (tooYoung.length) {
  console.log(
    `  ${tooYoung.length} unreferenced but newer than ${keepDays} day(s) — kept (${mb(total(tooYoung))})`
  );
}

if (!orphans.length) {
  console.log('\nNothing to prune.\n');
  process.exit(0);
}

console.log('');
for (const object of orphans) {
  console.log(`  ${object.key}  (${mb(object.size)}, uploaded ${object.uploaded ?? 'unknown'})`);
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to delete these ${orphans.length} object(s).\n`);
  process.exit(0);
}

let deleted = 0;
for (const object of orphans) {
  await deleteObject(object.key);
  deleted += 1;
  process.stdout.write(`\rdeleted ${deleted}/${orphans.length}`);
}
console.log(`\nFreed ${mb(total(orphans))}.\n`);
