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

/** The bare object key behind an `r2:` value, or undefined for anything else. */
export function r2Key(value: unknown): string | undefined {
  return isR2Value(value) ? value.slice(R2_PREFIX.length).replace(/^\/+/, '') : undefined;
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
 * Returns undefined for values that are not R2 keys (callers fall through to
 * their existing resolution) and for R2 keys on a site with no configured base
 * — there is no URL to build, and guessing one would emit a broken <img>.
 */
export function mediaUrl(value: unknown, base = mediaBase()): string | undefined {
  const key = r2Key(value);
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
export function isOptimisableR2(value: unknown): boolean {
  const key = r2Key(value);
  return !!key && !UNOPTIMISABLE.has(extensionOf(key));
}
