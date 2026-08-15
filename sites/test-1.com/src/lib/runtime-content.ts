/**
 * Runtime content store — the difference between this site and test-2.com.
 * ---------------------------------------------------------------------------
 * test-2.com reads `src/content/**` at BUILD time: a CMS edit is a commit, and
 * the change only appears once CI has rebuilt and redeployed the site.
 *
 * Here the same files are read at REQUEST time out of a KV namespace. Keystatic
 * still commits to git exactly as before — that is where content history lives —
 * but a GitHub webhook (see src/pages/api/content-sync.ts) pushes the changed
 * entries into KV within seconds of the commit, and the next request renders
 * them. No Actions run, no Astro build.
 *
 * KV layout
 *   doc:<path>   the entry, as { data, html? } — e.g. doc:settings/site,
 *                doc:services/tree-removal. `html` is only present for markdown,
 *                rendered once at sync time so no request pays for it.
 *   idx:<coll>   slugs in a collection, so a listing is one read plus one read
 *                per entry rather than a KV list scan.
 *   ver          commit SHA of the last sync; also the edge-cache generation.
 *
 * FALLBACK. Every read falls back to the copy bundled at build time. That is
 * what makes `astro dev` work unchanged (no bindings exist there), and it means
 * a site deployed before its first sync serves the committed content instead of
 * an empty page. KV is an overlay on the build, never a prerequisite for it.
 */
import { env as workerEnv } from 'cloudflare:workers';

type Env = { CONTENT?: KVNamespace };
const env = workerEnv as unknown as Env;

/** The KV binding, or null in dev / anywhere the binding is absent. */
export const store = (): KVNamespace | null => env.CONTENT ?? null;

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
// Reads
// ---------------------------------------------------------------------------
/**
 * One entry by path (no extension), e.g. `settings/site`, `pages/about`.
 * Throws when neither KV nor the bundle has it — a missing singleton is a bug,
 * not an empty page.
 */
export async function getDoc<T = Record<string, any>>(id: string): Promise<T> {
  const kv = store();

  if (kv) {
    const raw = await kv.get(`doc:${id}`, 'json');
    if (raw) return (raw as Doc<T>).data;
  }

  const fallback = bundled.get(id);
  if (!fallback) throw new Error(`Content entry not found: ${id}`);
  return fallback.data as T;
}

/** One entry with its rendered body — for the pages that render markdown. */
export async function getDocFull<T = Record<string, any>>(
  id: string
): Promise<Doc<T> | null> {
  const kv = store();

  if (kv) {
    const raw = (await kv.get(`doc:${id}`, 'json')) as Doc<T> | null;
    if (raw) return { ...raw, id, slug: id.split('/').pop()! };
  }

  return (bundled.get(id) as Doc<T> | undefined) ?? null;
}

/**
 * Every entry in a collection. Reads the index, then each entry — KV bills per
 * key, so a listing of 13 services is 14 reads. That is the cost of not
 * rebuilding, and the edge cache in middleware.ts is what stops most requests
 * from paying it.
 */
export async function listDocs<T = Record<string, any>>(
  collection: string
): Promise<Doc<T>[]> {
  const kv = store();

  if (kv) {
    const slugs = (await kv.get(`idx:${collection}`, 'json')) as string[] | null;
    if (slugs?.length) {
      const docs = await Promise.all(
        slugs.map((slug) => kv.get(`doc:${collection}/${slug}`, 'json'))
      );
      const found = docs.filter(Boolean) as Doc<T>[];
      // A partial index means a sync landed the index before every entry.
      // Prefer the bundle over rendering half a listing.
      if (found.length === slugs.length) {
        return found.map((doc, i) => ({
          ...doc,
          id: `${collection}/${slugs[i]}`,
          slug: slugs[i],
        }));
      }
    }
  }

  return [...bundled.values()].filter((doc) =>
    doc.id.startsWith(`${collection}/`)
  ) as Doc<T>[];
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
  const kv = store();
  if (!kv) return 'dev';
  return (await kv.get('ver')) ?? 'build';
}

// ---------------------------------------------------------------------------
// Settings — preloaded, then read synchronously
// ---------------------------------------------------------------------------
// The two settings singletons are read by almost everything, including
// `resolveSeo` and `fillTokens`, which are called 42 times across the site from
// ordinary synchronous expressions. Making those async to reach KV would have
// meant editing every call site and turning a pile of template expressions into
// awaits, for two values that are identical on every request.
//
// Instead middleware.ts calls `preloadSettings()` once per request and these
// accessors stay synchronous. The holder is module state shared by every
// request in the isolate, which is safe here precisely because the value does
// not vary by request: concurrent requests either write the same thing, or
// differ by one sync generation, which self-corrects on the next load.
//
// Both start as the copy bundled at build time, so a page rendered before any
// preload — or in dev, where there is no binding — still has real settings
// rather than undefined.
import siteBundle from '../content/settings/site.json';
import areaBundle from '../content/settings/locations.json';

export type SiteSettings = typeof siteBundle;
export type AreaSettings = typeof areaBundle;

const SETTINGS_TTL_MS = 5_000;

let settings = {
  site: siteBundle as SiteSettings,
  areas: areaBundle as AreaSettings,
  readAt: 0,
};

/** Refresh the settings holder. Call once per request, before rendering. */
export async function preloadSettings(): Promise<void> {
  if (!store()) return;
  if (settings.readAt && Date.now() - settings.readAt < SETTINGS_TTL_MS) return;

  const [site, areas] = await Promise.all([
    getDoc<SiteSettings>('settings/site').catch(() => settings.site),
    getDoc<AreaSettings>('settings/locations').catch(() => settings.areas),
  ]);

  settings = { site, areas, readAt: Date.now() };
}

/** Site settings — live after `preloadSettings`, bundled before it. */
export const siteSettings = (): SiteSettings => settings.site;

/** Service-area settings, same contract. */
export const areaSettings = (): AreaSettings => settings.areas;
