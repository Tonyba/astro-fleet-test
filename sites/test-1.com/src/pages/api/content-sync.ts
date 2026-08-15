/**
 * POST /api/content-sync — GitHub webhook receiver
 * ---------------------------------------------------------------------------
 * The bridge that lets this site skip the rebuild.
 *
 * Keystatic is git-based: a save is a commit, and on test-2.com that commit has
 * to go through CI and a full Astro build (~3 minutes) before anyone sees it.
 * Here GitHub calls this route on push instead. It pulls the content files the
 * commit touched, writes them into KV, and bumps the sync generation — which
 * also invalidates every edge-cached page (see middleware.ts). Seconds, no
 * build, no Actions run.
 *
 * Git stays the source of truth. KV is a derived read cache that can be thrown
 * away and rebuilt from the repo at any time with `?full=1`.
 *
 * Modes
 *   POST /api/content-sync            GitHub push webhook, HMAC-verified
 *   POST /api/content-sync?full=1     rebuild every key from the repo, for
 *                                     first seed or recovery; needs the same
 *                                     secret in `x-sync-secret`
 *
 * Environment (worker secrets)
 *   CONTENT_SYNC_SECRET  shared with the GitHub webhook
 *   GITHUB_TOKEN         optional; only raises GitHub rate limits (public repo)
 *   GITHUB_REPO          "owner/repo", defaults to tonyba/astro-fleet-test
 *   GITHUB_BRANCH        defaults to main
 */
import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { load as parseYaml } from 'js-yaml';
import { marked } from 'marked';

export const prerender = false;

type Env = {
  CONTENT?: KVNamespace;
  CONTENT_SYNC_SECRET?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
};

const env = workerEnv as unknown as Env;

/** Only files under here are content; everything else in a commit is ignored. */
const CONTENT_ROOT = 'sites/test-1.com/src/content/';

/** Collections that own an `idx:` list. Singletons are addressed directly. */
const COLLECTIONS = ['posts', 'services', 'locations', 'forms'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// ---------------------------------------------------------------------------
// Webhook authentication
// ---------------------------------------------------------------------------
/**
 * GitHub signs the raw body with HMAC-SHA256. `crypto.subtle.verify` is
 * constant-time, which a string compare of the hex digest would not be.
 */
async function validSignature(secret: string, body: string, header: string | null) {
  if (!header?.startsWith('sha256=')) return false;

  const hex = header.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;

  const signature = new Uint8Array(
    hex.match(/../g)!.map((byte) => parseInt(byte, 16))
  );

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(body));
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------
const repo = () => env.GITHUB_REPO || 'tonyba/astro-fleet-test';
const branch = () => env.GITHUB_BRANCH || 'main';

/**
 * A token is optional: this repository is public, and the token only raises
 * rate limits. Sending an empty Authorization header would be worse than
 * sending none, so only include it when there is one.
 */
const ghHeaders = () => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'test-1-content-sync',
  ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
});

/**
 * Raw file at a ref, or null when it no longer exists (a deletion).
 *
 * raw.githubusercontent.com rather than the contents API: it needs no auth for
 * a public repo and is not billed against the 60-requests-per-hour
 * unauthenticated API limit, which a worker on shared egress IPs would burn
 * through quickly.
 */
async function fetchFile(path: string, ref: string): Promise<string | null> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${repo()}/${encodeURIComponent(ref)}/${encodeURI(path)}`,
    { headers: { 'User-Agent': 'test-1-content-sync' }, cf: { cacheTtl: 0 } as any }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub raw ${res.status} for ${path}`);
  return res.text();
}

/** Every content file on the branch — the `?full=1` path. */
async function listContentFiles(ref: string): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${repo()}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: ghHeaders() }
  );
  if (!res.ok) throw new Error(`GitHub ${res.status} listing tree`);

  const tree = (await res.json()) as { tree: { path: string; type: string }[] };
  return tree.tree
    .filter(
      (node) =>
        node.type === 'blob' &&
        node.path.startsWith(CONTENT_ROOT) &&
        /\.(json|md)$/.test(node.path)
    )
    .map((node) => node.path);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
/** `sites/test-1.com/src/content/services/x.md` -> `services/x` */
const toId = (path: string) => path.slice(CONTENT_ROOT.length).replace(/\.(json|md)$/, '');

/**
 * Split Keystatic's YAML frontmatter from the body and render the body once,
 * here, so no page request ever pays for markdown parsing.
 */
function parseMarkdown(source: string): { data: Record<string, unknown>; html: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return { data: {}, html: marked.parse(source, { async: false }) as string };

  const data = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  const body = match[2].trim();
  return { data, html: body ? (marked.parse(body, { async: false }) as string) : '' };
}

function parseEntry(path: string, source: string) {
  return path.endsWith('.json')
    ? { data: JSON.parse(source) as Record<string, unknown>, html: '' }
    : parseMarkdown(source);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
/**
 * Rebuild the index for each collection touched. Derived from KV rather than
 * tracked incrementally, so a dropped webhook cannot leave an index that
 * disagrees with the entries beside it.
 */
async function reindex(kv: KVNamespace, collections: Set<string>) {
  for (const collection of collections) {
    const slugs: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await kv.list({ prefix: `doc:${collection}/`, cursor });
      for (const key of page.keys) slugs.push(key.name.slice(`doc:${collection}/`.length));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    slugs.sort();
    await kv.put(`idx:${collection}`, JSON.stringify(slugs));
  }
}

async function applyPaths(kv: KVNamespace, paths: string[], ref: string) {
  const touched = new Set<string>();
  let written = 0;
  let deleted = 0;

  for (const path of paths) {
    const id = toId(path);
    const collection = id.includes('/') ? id.split('/')[0] : '';
    if (COLLECTIONS.includes(collection)) touched.add(collection);

    const source = await fetchFile(path, ref);

    if (source === null) {
      await kv.delete(`doc:${id}`);
      deleted++;
      continue;
    }

    try {
      const entry = parseEntry(path, source);
      await kv.put(`doc:${id}`, JSON.stringify(entry));
      written++;
    } catch (error) {
      // One malformed entry must not abandon the rest of the sync — the site
      // keeps serving the previous value for it.
      console.error(`content-sync: skipping ${path}: ${(error as Error).message}`);
    }
  }

  if (touched.size) await reindex(kv, touched);
  return { written, deleted };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
export const POST: APIRoute = async ({ request, url }) => {
  const kv = env.CONTENT;
  const secret = env.CONTENT_SYNC_SECRET;

  if (!kv) return json({ error: 'CONTENT binding missing' }, 500);
  if (!secret) return json({ error: 'CONTENT_SYNC_SECRET not set' }, 500);

  const body = await request.text();
  const full = url.searchParams.get('full') === '1';

  // A full resync is an operator action, not a GitHub one, so it carries the
  // secret directly instead of a payload signature.
  if (full) {
    if (request.headers.get('x-sync-secret') !== secret) {
      return json({ error: 'bad secret' }, 401);
    }
  } else if (!(await validSignature(secret, body, request.headers.get('x-hub-signature-256')))) {
    return json({ error: 'bad signature' }, 401);
  }

  try {
    if (full) {
      const ref = branch();
      const paths = await listContentFiles(ref);
      const result = await applyPaths(kv, paths, ref);
      await kv.put('ver', `full-${Date.now()}`);
      return json({ mode: 'full', files: paths.length, ...result });
    }

    const payload = JSON.parse(body) as {
      ref?: string;
      after?: string;
      commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
    };

    // Only the branch the site serves.
    if (payload.ref && payload.ref !== `refs/heads/${branch()}`) {
      return json({ skipped: `not ${branch()}`, ref: payload.ref });
    }

    const paths = new Set<string>();
    for (const commit of payload.commits ?? []) {
      for (const path of [...(commit.added ?? []), ...(commit.modified ?? []), ...(commit.removed ?? [])]) {
        if (path.startsWith(CONTENT_ROOT) && /\.(json|md)$/.test(path)) paths.add(path);
      }
    }

    if (paths.size === 0) return json({ skipped: 'no content files in push' });

    const ref = payload.after || branch();
    const result = await applyPaths(kv, [...paths], ref);

    // Last, so a failure part-way leaves the old generation serving the old
    // pages rather than exposing a half-written one.
    await kv.put('ver', ref);

    return json({ mode: 'push', ref, files: paths.size, ...result });
  } catch (error) {
    console.error('content-sync failed', error);
    return json({ error: (error as Error).message }, 500);
  }
};

/** Liveness check — no secrets, no content, just whether it is wired up. */
export const GET: APIRoute = async () =>
  json({
    ok: true,
    binding: Boolean(env.CONTENT),
    secret: Boolean(env.CONTENT_SYNC_SECRET),
    token: Boolean(env.GITHUB_TOKEN),
    version: (await env.CONTENT?.get('ver')) ?? null,
  });
