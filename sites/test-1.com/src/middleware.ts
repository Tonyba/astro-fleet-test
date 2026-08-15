/**
 * Edge cache for on-demand pages.
 * ---------------------------------------------------------------------------
 * Every page here renders per request (that is how a CMS edit shows up without
 * a rebuild), which would otherwise mean a worker invocation and ~15 KV reads
 * for every visitor. This puts Cloudflare's cache in front, so a repeat view is
 * served from the edge at roughly static speed and never reaches the renderer.
 *
 * INVALIDATION IS BY KEY GENERATION, NOT BY PURGE. The cache key carries the
 * last synced commit SHA, so the moment content-sync writes a new `ver` every
 * previously cached URL is simply unreachable — no list of "pages this entry
 * touched" to compute, and no purge call that can half-fail. Superseded entries
 * are never served again and fall out on their own TTL.
 *
 * The generation itself is memoised for a few seconds. Reading `ver` from KV on
 * every request would put a KV read in front of every cache HIT, which is
 * exactly the cost this is here to avoid. The price is that an edit can take
 * that long to become visible on top of the sync itself.
 */
import type { MiddlewareHandler } from 'astro';
import { contentVersion, preloadSettings, store } from './lib/runtime-content';

/** How long a worker isolate may reuse the sync generation it last read. */
const VERSION_TTL_MS = 5_000;

/** How long the edge may keep a rendered page. Generation changes supersede it. */
const EDGE_TTL_SECONDS = 3600;

let cachedVersion = { value: '', readAt: 0 };

async function currentVersion(): Promise<string> {
  const now = Date.now();
  if (cachedVersion.value && now - cachedVersion.readAt < VERSION_TTL_MS) {
    return cachedVersion.value;
  }
  const value = await contentVersion();
  cachedVersion = { value, readAt: now };
  return value;
}

/**
 * Routes that must never be cached: the CMS and its API (per-editor, authed),
 * the form endpoint (a POST target), and anything else under /api.
 */
const NEVER_CACHE = [/^\/keystatic(\/|$)/, /^\/api(\/|$)/];

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);

  const isPage = !NEVER_CACHE.some((pattern) => pattern.test(url.pathname));

  const cacheable =
    request.method === 'GET' &&
    isPage &&
    // No binding means dev, where caching would only hide edits.
    store() !== null &&
    typeof caches !== 'undefined';

  // Settings are needed by anything that renders, whether or not this runtime
  // offers a cache — so this is gated on the route, not on cacheability.
  if (!cacheable) {
    if (isPage) await preloadSettings();
    return next();
  }

  const version = await currentVersion();

  // The generation lives in the key's path rather than a header so that two
  // generations of the same URL are genuinely different cache entries.
  const cacheKey = new Request(
    `${url.origin}/__cache/${version}${url.pathname}${url.search}`,
    { method: 'GET', headers: request.headers }
  );

  const cache = (caches as any).default as Cache;

  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('x-content-cache', 'HIT');
    headers.set('x-content-version', version);
    return new Response(hit.body, { status: hit.status, headers });
  }

  // Only on the way to rendering — a cache hit never needs settings, which is
  // the whole point of checking the cache first.
  await preloadSettings();

  const response = await next();

  // Only cache a clean HTML response. Caching a 404 or a 500 would pin a
  // transient failure to a URL for an hour.
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status === 200 && contentType.includes('text/html')) {
    const headers = new Headers(response.headers);
    headers.set('cache-control', `public, max-age=${EDGE_TTL_SECONDS}`);
    headers.set('x-content-version', version);

    const toCache = new Response(response.clone().body, { status: 200, headers });

    // `locals.runtime.ctx` was removed in Astro v6 and its getter THROWS, so
    // optional chaining on it does not degrade — it takes the response down.
    // v6 exposes the execution context as `locals.cfContext`.
    const cfContext = (context.locals as { cfContext?: ExecutionContext }).cfContext;
    if (cfContext?.waitUntil) {
      cfContext.waitUntil(cache.put(cacheKey, toCache));
    } else {
      // No execution context: store before responding rather than not at all.
      await cache.put(cacheKey, toCache);
    }

    const out = new Headers(headers);
    out.set('x-content-cache', 'MISS');
    return new Response(response.body, { status: 200, headers: out });
  }

  return response;
};
