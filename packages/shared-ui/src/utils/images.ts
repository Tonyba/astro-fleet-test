import type { ImageMetadata } from 'astro';

/**
 * images.ts
 * ---------
 * Bridges CMS-authored *string* image paths to the `ImageMetadata` objects that
 * `astro:assets` needs.
 *
 * Every photograph lives in a site's `src/assets/` so Astro can optimise it at
 * build time (public/ is copied verbatim and is therefore reserved for SVG
 * icons and the logo). Sveltia writes plain strings such as
 * `/src/assets/photos/hero-bg.jpg` into the content JSON, so we eagerly glob the
 * asset folder once and look the string up.
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

  const key = normalise(src);
  return bySrc.get(key) ?? bySrc.get(key.split('/').pop() ?? '');
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
