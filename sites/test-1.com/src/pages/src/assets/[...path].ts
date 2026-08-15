/**
 * GET /src/assets/<path> — serves an image that the build has not seen yet.
 * ---------------------------------------------------------------------------
 * The last thing on this site that needed a rebuild.
 *
 * Photographs are build inputs: `TreePicture` resolves `/src/assets/...` through
 * an `import.meta.glob` map compiled at build time, and Astro emits the
 * AVIF/WebP/fallback ladder into `dist/client/_astro/`. A photo uploaded through
 * Keystatic is committed to the repo and its reference syncs to D1 within
 * seconds — but the file itself is not in that map and not in `dist/`, so the
 * image was broken until CI finished.
 *
 * What made this cheap: TreePicture ALREADY degrades to a plain
 * `<img src="/src/assets/...">` when the glob misses. Nothing in shared-ui had
 * to change — that URL simply had to start serving, which is all this route
 * does. It reads the bytes from the repo, the same source the content sync
 * reads, and hands them back.
 *
 * This is a bridge, not a replacement. The image is served as uploaded: no
 * resizing, no AVIF, no WebP. CI still rebuilds on any change under
 * `src/assets/` (see `deploy.runtimeContent` in package.json — assets are
 * deliberately not treated as content), and once that lands the image is served
 * from the optimised ladder like every other. This route only covers the minute
 * in between, so an editor sees their photo immediately instead of a hole.
 */
import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';

export const prerender = false;

type Env = { GITHUB_REPO?: string; GITHUB_BRANCH?: string };
const env = workerEnv as unknown as Env;

const repo = () => env.GITHUB_REPO || 'tonyba/astro-fleet-test';
const branch = () => env.GITHUB_BRANCH || 'main';

/** Where this site's assets live in the repo. */
const ASSETS_ROOT = 'sites/test-1.com/src/assets/';

/**
 * Only images, and only ones this site owns. Without this the route would be an
 * open proxy for any file in the repository — the repo is public, so nothing is
 * leaked by it, but a URL on this domain should not serve arbitrary content.
 */
const ALLOWED = /^[A-Za-z0-9/_.-]+\.(png|jpe?g|webp|avif|gif|svg)$/;

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/**
 * A minute, matching the page cache. The bytes at a given path are not
 * immutable — an editor can replace a photo without its path changing — and
 * this only has to cover the gap until CI republishes the optimised version, so
 * there is nothing to gain from holding it longer.
 */
const TTL_SECONDS = 60;

export const GET: APIRoute = async ({ params }) => {
  const path = params.path ?? '';

  // `..` cannot escape ASSETS_ROOT once the pattern above has rejected it, but
  // check explicitly rather than rely on a regex to be a path validator.
  if (!ALLOWED.test(path) || path.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const upstream = `https://raw.githubusercontent.com/${repo()}/${encodeURIComponent(
    branch()
  )}/${encodeURI(ASSETS_ROOT + path)}`;

  const res = await fetch(upstream, {
    headers: { 'User-Agent': 'test-1-runtime-assets' },
    // Let Cloudflare cache the upstream fetch too, so a popular new image is
    // pulled from GitHub once per edge rather than once per request.
    cf: { cacheTtl: TTL_SECONDS, cacheEverything: true } as any,
  });

  if (!res.ok) {
    return new Response('Not found', { status: 404 });
  }

  const extension = path.split('.').pop()!.toLowerCase();

  return new Response(res.body, {
    status: 200,
    headers: {
      'content-type': TYPES[extension] ?? 'application/octet-stream',
      'cache-control': `public, max-age=0, s-maxage=${TTL_SECONDS}`,
      // Says plainly, in dev tools, that this image is the unoptimised bridge
      // copy rather than something the build produced.
      'x-image-source': 'runtime',
    },
  });
};
