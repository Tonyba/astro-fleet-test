#!/usr/bin/env node
/**
 * import-photo.mjs
 * ----------------
 * The ONLY supported way a photograph enters this repo.
 *
 * Photographs never travel Figma → repo: Figma exports vectors (SVG) only.
 * Photographs come from the camera/stock original and are re-encoded here into
 * a single high-quality **source** that lives in a site's `src/assets/`, where
 * Astro's `<Picture />` takes over and emits the AVIF / WebP / fallback
 * variants at build time.
 *
 * Rules applied to every import:
 *   - opaque images  → JPEG (quality 90, 4:4:4, mozjpeg) — no photographic PNG
 *     is ever written into the repo.
 *   - images with real transparency (badge seals, cut-out art) → PNG, because a
 *     JPEG would flatten the alpha onto a solid box. A cut-out *photograph* is
 *     far too heavy as a lossless PNG, so anything over `WEBP_ABOVE` is
 *     re-encoded as lossy WebP, which keeps the alpha at a fraction of the size.
 *   - downscaled to `--max-width` (never upscaled) so the source stays under the
 *     1 MB repo budget enforced by `scripts/check-file-sizes.mjs`.
 *
 * Usage:
 *   node scripts/import-photo.mjs <file...> --out sites/test-2.com/src/assets/photos [--max-width 1920] [--quality 90]
 */
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';

export const DEFAULT_QUALITY = 90;
export const DEFAULT_MAX_WIDTH = 1920;

/**
 * Fraction of pixels that are not fully opaque. Photo exports routinely carry a
 * junk alpha channel with a handful of sub-255 pixels along the edges; that is
 * not transparency worth keeping a PNG for, so anything under `threshold`
 * counts as opaque and gets flattened into a JPEG.
 */
const ALPHA_THRESHOLD = 0.01;

/**
 * A lossless PNG bigger than this is a photograph wearing a cut-out, not flat
 * art — switch it to lossy WebP so the alpha survives without the weight.
 */
const WEBP_ABOVE = 500 * 1024;

async function hasMeaningfulAlpha(src) {
  const { isOpaque } = await sharp(src, { limitInputPixels: false }).stats();
  if (isOpaque) return false;

  const { data, info } = await sharp(src, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let translucent = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 255) translucent++;
  return translucent / (info.width * info.height) >= ALPHA_THRESHOLD;
}

/**
 * Re-encode one image into `outDir` as a pipeline-ready source.
 * @returns {Promise<{ out: string, format: 'jpeg'|'png'|'webp', width: number, height: number, bytes: number }>}
 */
export async function importPhoto(src, outDir, options = {}) {
  const { maxWidth = DEFAULT_MAX_WIDTH, quality = DEFAULT_QUALITY, name } = options;

  const meta = await sharp(src, { limitInputPixels: false }).metadata();
  const keepAlpha = await hasMeaningfulAlpha(src);

  const width = Math.min(meta.width ?? maxWidth, maxWidth);
  const stem = name ?? basename(src, extname(src));

  await mkdir(outDir, { recursive: true });

  const base = () =>
    sharp(src, { limitInputPixels: false })
      .rotate() // honour EXIF orientation before we drop the metadata
      .resize({ width, withoutEnlargement: true });

  const encode = async (format) => {
    const ext = format === 'jpeg' ? 'jpg' : format;
    const out = join(outDir, `${stem}.${ext}`);
    // sharp refuses to read and write the same path, so land on a temp file when
    // re-encoding in place.
    const inPlace = resolve(out) === resolve(src);
    const target = inPlace ? `${out}.tmp` : out;

    let pipeline = base();
    if (format === 'jpeg') {
      pipeline = pipeline
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' });
    } else if (format === 'png') {
      pipeline = pipeline.png({ compressionLevel: 9, effort: 10 }); // lossless
    } else {
      pipeline = pipeline.webp({ quality, effort: 6, alphaQuality: 100 });
    }

    const info = await pipeline.toFile(target);
    if (inPlace) await rename(target, out);
    const { size } = await stat(out);
    return { out, format, width: info.width, height: info.height, bytes: size };
  };

  if (!keepAlpha) return encode('jpeg');

  const png = await encode('png');
  if (png.bytes <= WEBP_ABOVE) return png;

  // Cut-out photograph: keep the alpha, drop the lossless weight.
  const webp = await encode('webp');
  await removeIfPresent(png.out);
  return webp;
}

/** Delete a file if it exists (used by the one-off media migration). */
export async function removeIfPresent(file) {
  try {
    await unlink(file);
    return true;
  } catch {
    return false;
  }
}

const isCLI = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));

if (isCLI) {
  const args = process.argv.slice(2);
  const files = [];
  let outDir = null;
  let maxWidth = DEFAULT_MAX_WIDTH;
  let quality = DEFAULT_QUALITY;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') outDir = args[++i];
    else if (args[i] === '--max-width') maxWidth = Number(args[++i]);
    else if (args[i] === '--quality') quality = Number(args[++i]);
    else files.push(args[i]);
  }

  if (!files.length || !outDir) {
    console.error('Usage: node scripts/import-photo.mjs <file...> --out <src/assets/dir> [--max-width 1920] [--quality 90]');
    process.exit(1);
  }

  for (const file of files) {
    const r = await importPhoto(file, outDir, { maxWidth, quality });
    console.log(`${file} → ${r.out}  ${r.width}×${r.height} ${r.format} ${(r.bytes / 1024).toFixed(0)} KB`);
  }
}
