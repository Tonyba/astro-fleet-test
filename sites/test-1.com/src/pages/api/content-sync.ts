/**
 * POST /api/content-sync — GitHub webhook receiver
 * ---------------------------------------------------------------------------
 * The bridge that lets this site skip the rebuild.
 *
 * Keystatic is git-based: a save is a commit, and on test-2.com that commit has
 * to go through CI and a full Astro build (~3 minutes) before anyone sees it.
 * Here GitHub calls this route on push instead. It pulls the content files the
 * commit touched, writes them into D1, and bumps the sync generation — which
 * also invalidates every edge-cached page (see middleware.ts). Seconds, no
 * build, no Actions run.
 *
 * Git stays the source of truth. D1 holds a derived copy that can be thrown
 * away and rebuilt from the repo at any time with `?full=1`.
 *
 * Modes
 *   POST /api/content-sync            GitHub push webhook, HMAC-verified
 *   POST /api/content-sync?full=1     rebuild every row from the repo, for
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
  CONTENT_DB?: D1Database;
  CONTENT_SYNC_SECRET?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
};

const env = workerEnv as unknown as Env;

/** Only files under here are content; everything else in a commit is ignored. */
const CONTENT_ROOT = 'sites/test-1.com/src/content/';

/**
 * Form submissions live under CONTENT_ROOT so Keystatic can edit them, but they
 * are not page content and must never enter `docs`: every request loads that
 * table whole, so syncing leads would grow the per-request snapshot without
 * bound and put customer names and phone numbers in the content cache of a
 * site that renders none of them. The lead's real home is the `submissions`
 * table, written directly by /api/quote.
 */
const isContentPath = (path: string) =>
  path.startsWith(CONTENT_ROOT) &&
  !path.startsWith(`${CONTENT_ROOT}submissions/`) &&
  /\.(json|md)$/.test(path);

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
    .filter((node) => node.type === 'blob' && isContentPath(node.path))
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
 * Apply a set of changed paths to the database.
 *
 * Every statement runs in one `batch`, which D1 executes as a single
 * transaction and a single round trip: either the generation and every row it
 * describes land together, or nothing does. A half-applied sync would be a site
 * rendering a mix of two commits.
 *
 * There is no index to rebuild — a collection listing is a query against an
 * indexed column, so the rows ARE the index and cannot disagree with it. On KV
 * that index was a separate key that had to be recomputed on every sync.
 */
async function applyPaths(db: D1Database, paths: string[], ref: string, version: string) {
  const statements: D1PreparedStatement[] = [];
  let written = 0;
  let deleted = 0;

  const upsert = db.prepare(
    `INSERT INTO docs (id, collection, slug, data, html)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET
       collection = excluded.collection,
       slug       = excluded.slug,
       data       = excluded.data,
       html       = excluded.html`
  );
  const remove = db.prepare('DELETE FROM docs WHERE id = ?1');

  for (const path of paths) {
    const id = toId(path);
    const source = await fetchFile(path, ref);

    if (source === null) {
      statements.push(remove.bind(id));
      deleted++;
      continue;
    }

    try {
      const entry = parseEntry(path, source);
      const collection = id.includes('/') ? id.split('/')[0] : '';
      const slug = id.split('/').pop() ?? id;
      statements.push(
        upsert.bind(id, collection, slug, JSON.stringify(entry.data), entry.html)
      );
      written++;
    } catch (error) {
      // One malformed entry must not abandon the rest of the sync — the site
      // keeps serving the previous value for it.
      console.error(`content-sync: skipping ${path}: ${(error as Error).message}`);
    }
  }

  // The generation goes in the SAME batch, last. Readers use it to decide
  // whether their snapshot is stale, so it must never become visible before the
  // rows it stands for. On KV these were two separate writes, and the gap
  // between them let a request read the new generation and render the old
  // content — then cache that.
  statements.push(
    db
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('ver', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .bind(version)
  );

  await db.batch(statements);
  return { written, deleted };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
export const POST: APIRoute = async ({ request, url }) => {
  const db = env.CONTENT_DB;
  const secret = env.CONTENT_SYNC_SECRET;

  if (!db) return json({ error: 'CONTENT_DB binding missing' }, 500);
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
      const result = await applyPaths(db, paths, ref, `full-${Date.now()}`);
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
        if (isContentPath(path)) paths.add(path);
      }
    }

    if (paths.size === 0) return json({ skipped: 'no content files in push' });

    const ref = payload.after || branch();
    const result = await applyPaths(db, [...paths], ref, ref);

    // Last, and deliberately late.
    //
    // The generation was written inside the batch above, in the same
    // transaction as the rows it stands for — so there is no window in which a
    // reader can see the new generation and the old content.

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
    binding: Boolean(env.CONTENT_DB),
    secret: Boolean(env.CONTENT_SYNC_SECRET),
    token: Boolean(env.GITHUB_TOKEN),
    version:
      (await env.CONTENT_DB?.prepare("SELECT value FROM meta WHERE key = 'ver'")
        .first<{ value: string }>())?.value ?? null,
  });
