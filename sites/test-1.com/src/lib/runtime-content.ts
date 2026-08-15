/**
 * Runtime content store — the difference between this site and test-2.com.
 * ---------------------------------------------------------------------------
 * test-2.com reads `src/content/**` at BUILD time: a CMS edit is a commit, and
 * the change only appears once CI has rebuilt and redeployed the site.
 *
 * Here the same entries are read at REQUEST time from D1. Keystatic still
 * commits to git exactly as before — that is where content history lives — but
 * a GitHub webhook (see src/pages/api/content-sync.ts) writes the changed rows
 * within seconds of the commit, and the next request renders them. No Actions
 * run, no Astro build.
 *
 * WHY D1 AND NOT KV. This started on KV and behaved badly: an edit could take
 * up to a minute to appear. KV caches reads at the edge for `cacheTtl`, which
 * defaults to 60 seconds and cannot be set below 30, so a worker keeps serving
 * the previous value until that expires — Cloudflare's own documentation says
 * KV is "not recommended if your data is updated often and you need to see
 * updates shortly after they are written", which is exactly this workload.
 * Measured: a version key stayed stale for 58 seconds against the 60s default.
 * D1 is single-primary SQLite with strongly consistent reads, so a row the
 * webhook writes is visible to the very next request anywhere.
 *
 * SHAPE. The whole content set is ~32 small rows, so rather than querying per
 * entry — a page reads a dozen — an isolate holds a snapshot of all of them and
 * checks one tiny `ver` row to decide whether it is still current. Steady state
 * is one trivial query per request; a content change costs one more to reload.
 *
 * FALLBACK. Every read falls back to the copy bundled at build time. That is
 * what makes `astro dev` work unchanged (no bindings exist there), and it means
 * a site deployed before its first sync serves the committed content instead of
 * an empty page. D1 is an overlay on the build, never a prerequisite for it.
 */
import { env as workerEnv } from 'cloudflare:workers';

type Env = { CONTENT_DB?: D1Database };
const env = workerEnv as unknown as Env;

/** The D1 binding, or null in dev / anywhere the binding is absent. */
export const store = (): D1Database | null => env.CONTENT_DB ?? null;

export type Doc<T = Record<string, unknown>> = {
  /** Path without extension, e.g. `services/tree-removal`. */
  id: string;
  /** Final path segment — the slug used in URLs. */
  slug: string;
  data: T;
  /** Rendered markdown body. Empty for JSON entries and bodiless markdown. */
  html: string;
};

// ---------------------------------------------------------------------------
// Bundled fallback
// ---------------------------------------------------------------------------
// Eager globs so the content is in the bundle rather than fetched — these are
// the same files Keystatic commits, frozen at the last build.
const jsonModules = import.meta.glob<{ default: Record<string, unknown> }>(
  '../content/**/*.json',
  { eager: true }
);

const mdModules = import.meta.glob<{
  frontmatter: Record<string, unknown>;
  compiledContent: () => string;
}>('../content/**/*.md', { eager: true });

/** `../content/services/tree-removal.md` -> `services/tree-removal` */
const toId = (globPath: string) =>
  globPath.replace(/^\.\.\/content\//, '').replace(/\.(json|md)$/, '');

const bundled = new Map<string, Doc>();

for (const [path, mod] of Object.entries(jsonModules)) {
  const id = toId(path);
  bundled.set(id, { id, slug: id.split('/').pop()!, data: mod.default, html: '' });
}

for (const [path, mod] of Object.entries(mdModules)) {
  const id = toId(path);
  let html = '';
  try {
    html = mod.compiledContent();
  } catch {
    // A markdown module without compiled output is a bodiless entry, which is
    // most of them here — the frontmatter carries the content.
  }
  bundled.set(id, { id, slug: id.split('/').pop()!, data: mod.frontmatter, html });
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------
/**
 * How long an isolate may reuse the generation it last read before checking
 * again. This is the only staleness left in the system, and unlike KV's 30-60s
 * floor it is ours to choose: one second, so a burst of requests shares a
 * single `ver` query while an editor still sees their change effectively
 * immediately.
 */
const VERSION_TTL_MS = 1_000;

type Snapshot = { version: string; docs: Map<string, Doc> };

let snapshot: Snapshot | null = null;
let versionSeen = { value: '', readAt: 0 };

async function readVersion(db: D1Database): Promise<string> {
  const now = Date.now();
  if (versionSeen.value && now - versionSeen.readAt < VERSION_TTL_MS) {
    return versionSeen.value;
  }
  const row = await db
    .prepare("SELECT value FROM meta WHERE key = 'ver'")
    .first<{ value: string }>();
  versionSeen = { value: row?.value ?? 'empty', readAt: now };
  return versionSeen.value;
}

/**
 * The current content set, or null when there is no binding (dev). Reloads only
 * when the generation moved, so an unchanged site costs one small query.
 */
async function ensureSnapshot(): Promise<Snapshot | null> {
  const db = store();
  if (!db) return null;

  const version = await readVersion(db);
  if (snapshot?.version === version) return snapshot;

  const { results } = await db
    .prepare('SELECT id, slug, data, html FROM docs')
    .all<{ id: string; slug: string; data: string; html: string }>();

  // An empty table means the first sync has not run. Fall back to the bundle
  // rather than serving a site with no content.
  if (!results?.length) return null;

  const docs = new Map<string, Doc>();
  for (const row of results) {
    try {
      docs.set(row.id, {
        id: row.id,
        slug: row.slug,
        data: JSON.parse(row.data),
        html: row.html ?? '',
      });
    } catch {
      // One unparseable row must not take down every page; the bundled copy
      // covers it.
    }
  }

  snapshot = { version, docs };
  return snapshot;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
/**
 * One entry by path (no extension), e.g. `settings/site`, `pages/about`.
 * Throws when neither the store nor the bundle has it — a missing singleton is
 * a bug, not an empty page.
 */
export async function getDoc<T = Record<string, any>>(id: string): Promise<T> {
  const live = (await ensureSnapshot())?.docs.get(id);
  if (live) return live.data as T;

  const fallback = bundled.get(id);
  if (!fallback) throw new Error(`Content entry not found: ${id}`);
  return fallback.data as T;
}

/** One entry with its rendered body — for the pages that render markdown. */
export async function getDocFull<T = Record<string, any>>(
  id: string
): Promise<Doc<T> | null> {
  const live = (await ensureSnapshot())?.docs.get(id);
  if (live) return live as Doc<T>;
  return (bundled.get(id) as Doc<T> | undefined) ?? null;
}

/** Every entry in a collection. */
export async function listDocs<T = Record<string, any>>(
  collection: string
): Promise<Doc<T>[]> {
  const current = await ensureSnapshot();
  const source = current ? current.docs : bundled;
  const prefix = `${collection}/`;

  return [...source.values()].filter((doc) => doc.id.startsWith(prefix)) as Doc<T>[];
}

/** Non-draft entries, the filter every caller here applies. */
export async function listPublished<T extends { draft?: boolean }>(
  collection: string
): Promise<Doc<T>[]> {
  const docs = await listDocs<T>(collection);
  return docs.filter((doc) => !doc.data?.draft);
}

/**
 * Sync generation — the last synced commit SHA, or `build` before any sync.
 * middleware.ts folds it into the edge cache key so a sync invalidates every
 * cached page at once, without enumerating which pages an entry touched.
 */
export async function contentVersion(): Promise<string> {
  const db = store();
  if (!db) return 'dev';
  return readVersion(db);
}

// ---------------------------------------------------------------------------
// Settings — preloaded, then read synchronously
// ---------------------------------------------------------------------------
// The two settings singletons are read by almost everything, including
// `resolveSeo` and `fillTokens`, which are called 42 times across the site from
// ordinary synchronous expressions. Making those async to reach the database
// would have meant editing every call site and turning a pile of template
// expressions into awaits, for two values that are identical on every request.
//
// Instead middleware.ts calls `preloadSettings()` once per request and these
// accessors stay synchronous. The holder is module state shared by every
// request in the isolate, which is safe here precisely because the value does
// not vary by request.
//
// Both start as the copy bundled at build time, so a page rendered before any
// preload — or in dev, where there is no binding — still has real settings
// rather than undefined.
import siteBundle from '../content/settings/site.json';
import areaBundle from '../content/settings/locations.json';

export type SiteSettings = typeof siteBundle;
export type AreaSettings = typeof areaBundle;

let settings = {
  site: siteBundle as SiteSettings,
  areas: areaBundle as AreaSettings,
};

/** Refresh the settings holder. Call once per request, before rendering. */
export async function preloadSettings(): Promise<void> {
  const current = await ensureSnapshot();
  if (!current) return;

  settings = {
    site: (current.docs.get('settings/site')?.data as SiteSettings) ?? settings.site,
    areas: (current.docs.get('settings/locations')?.data as AreaSettings) ?? settings.areas,
  };
}

/** Site settings — live after `preloadSettings`, bundled before it. */
export const siteSettings = (): SiteSettings => settings.site;

/** Service-area settings, same contract. */
export const areaSettings = (): AreaSettings => settings.areas;
