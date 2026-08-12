#!/usr/bin/env node
/**
 * optimize-images.mjs
 * -------------------
 * Converts every raster image (.png/.jpg/.jpeg) under a site's public/media
 * folder to AVIF using the ShortPixel Reducer API (post-reducer endpoint),
 * writing a sibling `<name>.avif` next to each original. Components reference
 * the `.avif` (with the original kept as a <picture> fallback).
 *
 * Usage:
 *   SHORTPIXEL_API_KEY=xxxx node scripts/optimize-images.mjs [mediaDir]
 *   bun scripts/optimize-images.mjs sites/test-2.com/public/media
 *
 * The API key defaults to the project key when the env var is unset.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname, dirname, basename } from 'node:path';

const API_KEY = process.env.SHORTPIXEL_API_KEY || 'HboXFLdoxxZa95UO2i1A';
const ENDPOINT = 'https://api.shortpixel.com/v2/post-reducer.php';
const MEDIA_DIR = process.argv[2] || 'sites/test-2.com/public/media';
const RASTER = new Set(['.png', '.jpg', '.jpeg']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (RASTER.has(extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Submit one file and poll until ShortPixel returns the AVIF URL. */
async function optimize(file) {
  const buf = await readFile(file);
  const name = basename(file);

  for (let attempt = 0; attempt < 12; attempt++) {
    const form = new FormData();
    form.append('key', API_KEY);
    form.append('plugin_version', 'cli1.0');
    form.append('lossy', '1');
    form.append('convertto', '+avif');
    form.append('wait', '30');
    form.append('file_paths', JSON.stringify({ file1: name }));
    form.append('file1', new Blob([buf]), name);

    const res = await fetch(ENDPOINT, { method: 'POST', body: form });
    const json = await res.json();
    const item = Array.isArray(json) ? json[0] : json;
    const avifUrl = item?.AVIFURL || item?.AVIFLossyURL;

    if (avifUrl && avifUrl !== 'NA') return avifUrl;
    if (item?.Status?.Code && Number(item.Status.Code) < 0) {
      throw new Error(`ShortPixel error for ${name}: ${item.Status.Message}`);
    }
    await sleep(4000); // still scheduled — wait and re-poll
  }
  throw new Error(`Timed out waiting for AVIF: ${name}`);
}

async function main() {
  const files = await walk(MEDIA_DIR);
  console.log(`Found ${files.length} raster image(s) under ${MEDIA_DIR}`);
  let done = 0, skipped = 0;

  for (const file of files) {
    const avif = join(dirname(file), basename(file, extname(file)) + '.avif');
    if (await exists(avif)) {
      const [src, out] = await Promise.all([stat(file), stat(avif)]);
      if (out.mtimeMs >= src.mtimeMs) { skipped++; continue; } // up to date
    }
    try {
      process.stdout.write(`Optimizing ${file} … `);
      const url = await optimize(file);
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
      await writeFile(avif, bytes);
      console.log(`→ ${basename(avif)} (${(bytes.length / 1024).toFixed(0)} KB)`);
      done++;
    } catch (err) {
      console.error(`\n  ✗ ${err.message}`);
    }
  }
  console.log(`\nDone. Optimized ${done}, skipped ${skipped} (already current).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
