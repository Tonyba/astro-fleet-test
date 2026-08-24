import { fileURLToPath } from 'node:url';

import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import editableRegions from '@cloudcannon/editable-regions/astro-integration';

// The site URL has exactly one home: `siteUrl` in the CMS site settings. Feeding
// `site` from it makes `Astro.site` — and therefore every canonical, og:url,
// sitemap and robots.txt entry — follow whatever the CMS says. Nothing that
// renders a URL may hardcode the domain.
// NOTE: this is read at config load, so changing it needs a dev-server restart.
import site from './src/content/settings/site.json';

// ---------------------------------------------------------------------------
// Media bucket
// ---------------------------------------------------------------------------
// Photographs live in R2, and content files store only `r2:<key>` — so the
// bucket's public origin has to be known at BUILD time, twice over: to turn
// those keys into URLs, and to authorise Astro to download and re-encode them.
//
// This site is a clone of test-2.com and reads the SAME bucket: the photographs
// are the same business's, and duplicating them would double the storage for no
// gain. An env var still wins, which is what lets a preview deploy point at a
// different bucket without touching content.
const mediaBaseUrl = (
  process.env.PUBLIC_MEDIA_BASE_URL ||
  site.business?.technical?.mediaBaseUrl ||
  ''
).replace(/\/+$/, '');

// Read back by @astro-fleet/shared-ui through import.meta.env, which Vite fills
// from process.env for PUBLIC_-prefixed names.
process.env.PUBLIC_MEDIA_BASE_URL = mediaBaseUrl;

/** Astro only optimises remote images from domains it has been told to trust. */
const mediaRemotePattern = mediaBaseUrl
  ? [
      {
        protocol: new URL(mediaBaseUrl).protocol.replace(':', ''),
        hostname: new URL(mediaBaseUrl).hostname,
      },
    ]
  : [];

// The Cloudflare adapter is applied to BUILDS ONLY. `astro dev` then runs on
// Astro's own Node server, where `cloudflare:workers` does not exist — the vite
// alias below stubs it so /api/quote still imports cleanly in dev.
const isBuild = process.argv.includes('build');

export default defineConfig({
  site: site.siteUrl,

  // Every page is prerendered to static HTML. The adapter exists for the one
  // route that cannot be: POST /api/quote, which verifies Turnstile and commits
  // the submission back to the repo. CloudCannon hosts the prerendered output
  // (dist/client); the worker in dist/server is what Cloudflare runs.
  output: 'static',
  adapter: isBuild
    ? cloudflare({
        // Images are optimised at build time with sharp; nothing is resized at
        // runtime, so the worker needs no image service.
        imageService: 'compile',
      })
    : undefined,

  // Photographs come from the bucket, so the build has to be allowed to fetch
  // them. With this in place `<Picture>` treats an R2 original exactly like an
  // imported asset: downloaded once, measured, and encoded to AVIF/WebP/JPEG at
  // the widths each slot asks for — output files, not runtime transforms.
  image: { remotePatterns: mediaRemotePattern },

  // editableRegions() powers CloudCannon's Visual Editor: it reads the
  // data-editable / data-prop attributes in src/pages/ and wires each one back
  // to its source file. Inert outside the CloudCannon preview.
  integrations: [sitemap(), editableRegions()],

  vite: {
    plugins: [tailwindcss()],
    // `cloudflare:workers` only exists once the adapter is loaded, so in dev it
    // resolves to a stub that hands back an empty env.
    resolve: isBuild
      ? {}
      : {
          alias: {
            'cloudflare:workers': fileURLToPath(
              new URL('./src/lib/cloudflare-env-dev.ts', import.meta.url)
            ),
          },
        },
  },

  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Libre Franklin',
      cssVariable: '--font-heading',
      weights: [400, 500, 600, 700, 800],
    },
    {
      provider: fontProviders.google(),
      name: 'Libre Franklin',
      cssVariable: '--font-body',
      weights: [400, 500, 600, 700],
    },
  ],
});
