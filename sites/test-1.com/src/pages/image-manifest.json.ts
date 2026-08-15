/**
 * GET /image-manifest.json — the site's image ladder, built by Astro.
 * ---------------------------------------------------------------------------
 * Astro optimises images at BUILD time and only for PRERENDERED routes. Every
 * page here renders on demand so its CMS text is live without a rebuild, and
 * the price was the whole image pipeline: `<Picture>` fell through to the
 * runtime image service, and workerd has no sharp, so the adapter served the
 * source file untouched. Measured: this site's build emitted 0 AVIF variants
 * against 159 for prerendered test-2.com.
 *
 * A prerendered route, though, does not have to be a page. This endpoint is
 * prerendered, so calling `getImage()` here makes the build encode the ladder
 * exactly as it does for test-2.com — Astro's own service, Astro's quality —
 * and hands back the URLs it produced. The pages then point at those.
 *
 * So the split the site wants falls out naturally:
 *   text changed  -> content webhook, live in ~2s, no build (CI skips it)
 *   image changed -> CI rebuilds and THIS endpoint regenerates the ladder as
 *                    part of that build
 *
 * That second line used to hold for a plain reason: an image lived in
 * `src/assets/`, which is not content, so any image change was a code change.
 * Uploads go to R2 now and change nothing but a `r2:<key>` string inside a
 * content file — which would have looked exactly like a text edit and skipped
 * the build, leaving the new photo served unoptimised forever. Two things stop
 * that: this endpoint also encodes every R2 key the content references (below),
 * and CI refuses to treat a diff that introduces an unseen `r2:` key as
 * content-only. If you change one, change the other.
 *
 * The manifest is read at runtime through the ASSETS binding — see
 * `src/lib/image-manifest.ts`. It cannot simply be imported: Astro builds the
 * server bundle before it prerenders, so this file does not exist yet at the
 * moment the worker is compiled.
 */
import type { APIRoute } from 'astro';
import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import { inferRemoteSize } from 'astro/assets/utils';
import { isR2Value, mediaUrl, extensionOf } from '@astro-fleet/shared-ui/src/media/media-url';

export const prerender = true;

/**
 * Every width any TreePicture variant asks for — the union of its `hero`,
 * `card` and `inline` ladders. Astro clamps each to the source width and never
 * upscales, so a 400px badge costs one variant and only a hero pays for all of
 * them. Keep in step with VARIANT_WIDTHS in TreePicture.astro.
 */
const WIDTHS = [400, 600, 640, 800, 1024, 1200, 1440, 1920];

/** Matches TreePicture's QUALITY. */
const QUALITY = 90;

// Root-relative so Vite resolves it against this site.
const images = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/**/*.{jpeg,jpg,png,webp,avif,tiff}',
  { eager: true }
);

/**
 * The committed content, read as data so every `r2:<key>` in it can be
 * encoded too. This is the same JSON the build compiles against and the same
 * JSON the webhook syncs into D1, so a key that is live is a key that is here —
 * unless it arrived after this build, which is what the CI rule covers.
 */
const contentFiles = import.meta.glob<Record<string, unknown>>('/src/content/**/*.json', {
  eager: true,
});

/** Every distinct `r2:` value anywhere in the content tree. */
function r2KeysInContent(): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      if (isR2Value(node)) found.add(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };
  walk(contentFiles);
  return [...found];
}

export type ImageManifestEntry = {
  width: number;
  height: number;
  /** srcset attribute per format, ready to drop into a <source>. */
  avif: string;
  webp: string;
  /** The no-modern-format branch: its own srcset plus a plain src. */
  fallback: { src: string; srcset: string; type: string };
};

export const GET: APIRoute = async () => {
  const manifest: Record<string, ImageManifestEntry> = {};

  for (const [path, mod] of Object.entries(images)) {
    const source = mod.default;

    // A cut-out photograph must not be flattened onto a white box, so the
    // fallback follows the source. Mirrors `fallbackFor` in TreePicture.
    const fallbackFormat = source.format === 'png' ? 'png' : 'jpeg';
    const widths = WIDTHS.filter((w) => w <= source.width);
    if (!widths.length) widths.push(source.width);

    const [avif, webp, fallback] = await Promise.all([
      getImage({ src: source, widths, format: 'avif', quality: QUALITY }),
      getImage({ src: source, widths, format: 'webp', quality: QUALITY }),
      getImage({ src: source, widths, format: fallbackFormat, quality: QUALITY }),
    ]);

    manifest[path] = {
      width: source.width,
      height: source.height,
      avif: avif.srcSet.attribute,
      webp: webp.srcSet.attribute,
      fallback: {
        src: fallback.src,
        srcset: fallback.srcSet.attribute,
        type: `image/${fallbackFormat}`,
      },
    };
  }

  // ---- R2 uploads ---------------------------------------------------------
  // Keyed by the exact value the content file holds (`r2:<key>`), which is what
  // `ladderFor` looks up. `inferSize` makes Astro download the original once to
  // measure it, so the width ladder is clamped to the source exactly as it is
  // for a local import and nothing is upscaled.
  //
  // A bucket that is unreachable must not take the build down with it: one
  // broken key would otherwise cost the whole deploy, and the page renders
  // perfectly well from the original in the meantime.
  for (const value of r2KeysInContent()) {
    const url = mediaUrl(value);
    // Vectors and animations have no ladder to build; TreePicture serves them
    // straight from the bucket.
    if (!url || ['svg', 'gif', 'ico'].includes(extensionOf(value))) continue;

    const fallbackFormat = extensionOf(value) === 'png' ? 'png' : 'jpeg';
    try {
      // Measured first for the same reason the local branch above filters on
      // `source.width`: every width over the source encodes to a file identical
      // to the one at the source width.
      // Everything over the source collapses onto it, so those are replaced by
      // the source width itself rather than dropped — otherwise the ladder ends
      // one size short of what the bucket holds.
      const size = await inferRemoteSize(url).catch(() => null);
      const widths = size
        ? [
            ...WIDTHS.filter((w) => w < size.width),
            ...(WIDTHS.some((w) => w >= size.width) ? [size.width] : []),
          ]
        : WIDTHS;

      const [avif, webp, fallback] = await Promise.all(
        (['avif', 'webp', fallbackFormat] as const).map((format) =>
          getImage({
            src: url,
            ...(size ? { width: size.width, height: size.height } : { inferSize: true as const }),
            widths,
            format,
            quality: QUALITY,
          })
        )
      );

      manifest[value] = {
        // Only ever informational: TreePicture takes its intrinsic attributes
        // from the layout props, so an unknown source size costs nothing.
        width: avif.options.width ?? 0,
        height: avif.options.height ?? 0,
        avif: avif.srcSet.attribute,
        webp: webp.srcSet.attribute,
        fallback: {
          src: fallback.src,
          srcset: fallback.srcSet.attribute,
          type: `image/${fallbackFormat}`,
        },
      };
    } catch (error) {
      console.warn(`[image-manifest] could not encode ${value}: ${(error as Error).message}`);
    }
  }

  return new Response(JSON.stringify(manifest), {
    headers: { 'content-type': 'application/json' },
  });
};
