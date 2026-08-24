/**
 * media-url.ts
 * ------------
 * The contract between what the CMS stores and what the site renders.
 *
 * A photograph uploaded through Keystatic no longer lands in the repo: it goes
 * to an R2 bucket and the content file keeps only its key, written with an
 * `r2:` sentinel so it can never be confused with the legacy repo paths:
 *
 *   r2:photos/homepage/hero-3f2a9c1b.jpg     <- R2 object key
 *   https://<bucket>/photos/hero-3f2a9c1b.jpg <- the same object, written by a
 *                                               CloudCannon R2 DAM, which can
 *                                               only store fully qualified URLs
 *   /src/assets/photos/hero-bg.jpg           <- legacy, still resolved by images.ts
 *   /media/icons/faq-chevron.svg             <- public/, untouched
 *
 * Keeping the key (not the full URL) means the bucket can move to a custom
 * domain without rewriting a single content file. The public base lives in ONE
 * place — `business.technical.mediaBaseUrl` in the site's settings — which
 * astro.config.mjs inlines as PUBLIC_MEDIA_BASE_URL at build time.
 */

/** Sentinel that marks a value as an R2 object key. */
export const R2_PREFIX = 'r2:';

/** True for values stored by the r2Image field. */
export function isR2Value(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(R2_PREFIX);
}

/**
 * True for an absolute URL served by this site's media bucket.
 *
 * A CloudCannon R2 DAM cannot write the `r2:` sentinel — it stores fully
 * qualified URLs — so the bucket origin is what identifies those values.
 */
export function isMediaUrl(value: unknown, base = mediaBase()): value is string {
  if (typeof value !== 'string' || !base) return false;
  return value === base || value.startsWith(`${base}/`);
}

/** True for either notation: the `r2:` sentinel or a URL on the bucket. */
export function isBucketValue(value: unknown, base = mediaBase()): value is string {
  return isR2Value(value) || isMediaUrl(value, base);
}

/** Percent-decode one path segment, leaving a malformed escape untouched. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The bare object key behind a bucket value, or undefined for anything else.
 *
 * Accepts both notations, so a photo swapped in through the CloudCannon DAM
 * takes exactly the same build-time optimisation path as one the `r2:` uploader
 * wrote. The key is returned decoded, which is the form `mediaUrl` re-encodes.
 */
export function r2Key(value: unknown, base = mediaBase()): string | undefined {
  if (isR2Value(value)) return value.slice(R2_PREFIX.length).replace(/^\/+/, '');
  if (!isMediaUrl(value, base)) return undefined;

  const path = value.slice(base.length).replace(/[?#].*$/, '').replace(/^\/+/, '');
  return path ? path.split('/').map(decodeSegment).join('/') : undefined;
}

/** Wrap a key back into the stored form. */
export function toR2Value(key: string): string {
  return `${R2_PREFIX}${key.replace(/^\/+/, '')}`;
}

/**
 * The bucket's public origin, without a trailing slash.
 *
 * Read from PUBLIC_MEDIA_BASE_URL, which each site's astro.config.mjs defines
 * from its CMS settings. Empty until a bucket is configured — every caller
 * treats that as "no R2 on this site" rather than throwing, so a site that has
 * not been pointed at a bucket keeps rendering its repo-based images.
 */
export function mediaBase(): string {
  // Written exactly like this on purpose: Vite substitutes the literal
  // `import.meta.env.PUBLIC_MEDIA_BASE_URL` at build time. Reaching it through
  // a variable or an optional chain would leave the lookup to run at runtime,
  // where the worker has no import.meta.env to read.
  const raw: string = import.meta.env.PUBLIC_MEDIA_BASE_URL ?? '';
  return raw.replace(/\/+$/, '');
}

/**
 * Absolute URL for a stored image value.
 *
 * Returns undefined for values that are not bucket-backed (callers fall through
 * to their existing resolution) and for R2 keys on a site with no configured
 * base — there is no URL to build, and guessing one would emit a broken <img>.
 */
export function mediaUrl(value: unknown, base = mediaBase()): string | undefined {
  const key = r2Key(value, base);
  if (!key || !base) return undefined;
  // Keys are path-shaped and already safe; encode only what a filename may
  // legitimately contain (spaces, #, ?) so the URL survives an <img src>.
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Extension of a key, lowercased, without the dot. */
export function extensionOf(keyOrName: string): string {
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(keyOrName);
  return match ? match[1].toLowerCase() : '';
}

/** Formats Astro cannot put through sharp — they render as a plain <img>. */
const UNOPTIMISABLE = new Set(['svg', 'gif', 'ico']);

/** Whether a value points at a raster the image pipeline can re-encode. */
export function isOptimisableR2(value: unknown, base = mediaBase()): boolean {
  const key = r2Key(value, base);
  return !!key && !UNOPTIMISABLE.has(extensionOf(key));
}
