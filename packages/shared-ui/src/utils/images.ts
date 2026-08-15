import type { ImageMetadata } from 'astro';
import { isR2Value, mediaUrl } from '../media/media-url';

/**
 * images.ts
 * ---------
 * Bridges CMS-authored *string* image paths to something `astro:assets` can
 * optimise. Two kinds of string arrive here, and both end up optimised:
 *
 *   `r2:photos/hero-3f2a9c1b.jpg`  a CMS upload living in the R2 bucket. The
 *                                  build fetches it from the bucket's public
 *                                  URL and encodes the ladder with sharp, so
 *                                  the site still ships local AVIF/WebP files
 *                                  and pays nothing at request time.
 *   `/src/assets/photos/hero.jpg`  the repo-based path this fleet used before
 *                                  R2, and still the right home for anything
 *                                  committed by hand. Globbed eagerly below.
 *
 * The glob pattern is root-relative, so Vite resolves it against the *site*
 * being built — this file is shared, the assets it finds are not.
 */
const modules = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/**/*.{jpeg,jpg,png,webp,avif,gif,tiff}',
  { eager: true }
);

/** Longest-to-shortest keys for one asset: full path, sub-path, bare filename. */
const bySrc = new Map<string, ImageMetadata>();

for (const [path, mod] of Object.entries(modules)) {
  const meta = mod.default;
  const withoutRoot = path.replace(/^\/src\/assets\//, '');
  const filename = withoutRoot.split('/').pop()!;

  bySrc.set(path, meta); //           /src/assets/photos/hero-bg.jpg
  bySrc.set(withoutRoot, meta); //    photos/hero-bg.jpg
  if (!bySrc.has(filename)) bySrc.set(filename, meta); // hero-bg.jpg
}

/** Normalises the handful of shapes a path can arrive in (CMS, props, imports). */
function normalise(src: string): string {
  return src
    .trim()
    .replace(/^~?\/?@?assets\//, '') //          @assets/photos/x.jpg
    .replace(/^\.{0,2}\/*src\/assets\//, '') //  ../src/assets/x.jpg, /src/assets/x.jpg
    .replace(/^\/+/, ''); //                     leading slashes
}

export function isImageMetadata(src: unknown): src is ImageMetadata {
  return typeof src === 'object' && src !== null && 'src' in src && 'width' in src;
}

/**
 * Resolve a CMS/prop value to `ImageMetadata`.
 * Returns `undefined` for anything not under `src/assets` (SVG icons served
 * straight from public/, remote URLs, …) so callers can fall back to `<img>`.
 */
export function resolveImage(src: string | ImageMetadata): ImageMetadata | undefined {
  if (isImageMetadata(src)) return src;
  if (typeof src !== 'string' || !src) return undefined;
  // An R2 key is not in the repo and has no ImageMetadata — callers reach for
  // `remoteSource` instead. Bailing out here keeps it from matching a
  // same-named asset by the filename fallback below.
  if (isR2Value(src)) return undefined;

  const key = normalise(src);
  return bySrc.get(key) ?? bySrc.get(key.split('/').pop() ?? '');
}

/**
 * Absolute URL for a value the build should fetch and optimise rather than
 * import: today that means anything stored in R2. Returns undefined for repo
 * paths (use `resolveImage`) and for R2 values on a site with no bucket
 * configured, where there is no URL to build.
 */
export function remoteSource(src: string | ImageMetadata): string | undefined {
  if (isImageMetadata(src) || typeof src !== 'string') return undefined;
  return mediaUrl(src);
}

/**
 * Read metadata without marking the asset as "used outside the image pipeline".
 * Astro proxies `ImageMetadata` and emits the untouched original whenever a
 * property is read; `clone` is the documented escape hatch (`<Picture />` uses
 * it internally for exactly this reason).
 */
export function peek(image: ImageMetadata): ImageMetadata {
  return (image as ImageMetadata & { clone?: ImageMetadata }).clone ?? image;
}

// ---------------------------------------------------------------------------
// Pre-built ladder (on-demand sites only)
// ---------------------------------------------------------------------------
/**
 * Astro optimises images at BUILD time, and only for PRERENDERED routes. A site
 * that renders pages on demand — so its CMS text is live without a rebuild —
 * gets nothing from `<Picture>` but the untouched original, because workerd has
 * no sharp at request time.
 *
 * Such a site prerenders ONE route that calls `getImage()` for every asset,
 * which makes the build encode the ladder exactly as it would for a static
 * site, then registers the resulting URLs here before rendering. Sites that do
 * not do this never call `setImageLadder`, the map stays empty, `ladderFor`
 * returns undefined, and nothing below changes for them.
 */
export type ImageLadder = {
  width: number;
  height: number;
  /** srcset attribute per format, as Astro emitted it. */
  avif: string;
  webp: string;
  fallback: { src: string; srcset: string; type: string };
};

let ladder: Record<string, ImageLadder> | null = null;
let ladderDriven = false;

/** Called once per request by the site's middleware, before anything renders. */
export function setImageLadder(manifest: Record<string, ImageLadder> | null): void {
  ladder = manifest;
  // The CALL is the signal, not the manifest. A site that loads its ladder at
  // request time is an on-demand site whether or not the load succeeded, and
  // `usesLadder` has to keep saying so — a failed load (dev, or a missing
  // asset) hands back null, and treating that as "no ladder here" would send
  // TreePicture down the encode-it-now path in a runtime that cannot encode.
  ladderDriven = true;
}

/**
 * Whether this site renders against a pre-built ladder.
 *
 * It answers a question TreePicture has to get right for R2 images: may it call
 * `getImage()` on a remote URL? On a prerendered site, render time IS build
 * time, sharp is present, and the answer is yes. On an on-demand site the same
 * call would run inside workerd on every request — no sharp to encode with, and
 * a subrequest per image just to measure it. There, an image the build never
 * saw is served straight from the bucket instead.
 */
export function usesLadder(): boolean {
  return ladderDriven;
}

/** The pre-built variants for a source path, if this site has any. */
export function ladderFor(src: string | ImageMetadata): ImageLadder | undefined {
  if (!ladder || typeof src !== 'string' || !src) return undefined;

  // R2 entries are stored under the exact value the content file holds, so
  // there is nothing to normalise and no filename fallback to fall back to.
  if (isR2Value(src)) return ladder[src];

  const key = normalise(src);
  return (
    ladder[`/src/assets/${key}`] ??
    // Same last resort as resolveImage: match on filename alone.
    ladder[
      Object.keys(ladder).find((path) => path.endsWith(`/${key.split('/').pop()}`)) ?? ''
    ]
  );
}
