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
 *   image changed -> `src/assets/` is not content, so CI rebuilds, and THIS
 *                    endpoint regenerates the ladder as part of that build
 *
 * The manifest is read at runtime through the ASSETS binding — see
 * `src/lib/image-manifest.ts`. It cannot simply be imported: Astro builds the
 * server bundle before it prerenders, so this file does not exist yet at the
 * moment the worker is compiled.
 */
import type { APIRoute } from 'astro';
import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';

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

  return new Response(JSON.stringify(manifest), {
    headers: { 'content-type': 'application/json' },
  });
};
