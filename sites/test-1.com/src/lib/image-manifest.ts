/**
 * Loads the image ladder Astro built, for pages that render on demand.
 * ---------------------------------------------------------------------------
 * `src/pages/image-manifest.json.ts` is prerendered, so the build encodes the
 * AVIF/WebP ladder there and records the URLs. This reads that file back at
 * request time and hands it to shared-ui, so `<TreePicture>` can emit real
 * `<source>` elements instead of falling through to the runtime image service —
 * which on Workers cannot optimise anything, because workerd has no sharp.
 *
 * WHY FETCHED AND NOT IMPORTED. Astro builds the server bundle BEFORE it
 * prerenders, so at the moment this module is compiled the manifest does not
 * exist yet. It has to be read at runtime, through the worker's own ASSETS
 * binding — a local lookup, not a network request.
 *
 * Read once per isolate and kept. The manifest only changes when a build
 * changes it, and a build replaces the isolate.
 */
import { env as workerEnv } from 'cloudflare:workers';
import type { ImageLadder } from '@astro-fleet/shared-ui/src/utils/images';

type Env = { ASSETS?: { fetch: (request: Request) => Promise<Response> } };
const env = workerEnv as unknown as Env;

let cached: Record<string, ImageLadder> | null | undefined;

export async function loadImageManifest(): Promise<Record<string, ImageLadder> | null> {
  if (cached !== undefined) return cached;

  const assets = env.ASSETS;
  if (!assets) {
    // Dev, where there is no binding and no build output to read. TreePicture
    // falls back to its normal path, which in dev is Astro's own dev-time image
    // service — so images look right while developing regardless.
    cached = null;
    return cached;
  }

  try {
    // The host is arbitrary; the ASSETS binding routes on the path alone.
    const res = await assets.fetch(new Request('https://assets.local/image-manifest.json'));
    cached = res.ok ? ((await res.json()) as Record<string, ImageLadder>) : null;
    if (!res.ok) {
      console.error(`image-manifest: ASSETS returned ${res.status}; images will be unoptimised`);
    }
  } catch (error) {
    console.error(`image-manifest: could not load — ${(error as Error).message}`);
    cached = null;
  }

  return cached;
}
