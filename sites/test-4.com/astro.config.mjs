import { fileURLToPath } from 'node:url';

import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// The site URL has exactly one home: `siteUrl` in the CMS site settings. Feeding
// `site` from it makes `Astro.site` — and therefore every canonical, og:url,
// sitemap and robots.txt entry — follow whatever the CMS says. Nothing that
// renders a URL may hardcode the domain.
// NOTE: this is read at config load, so changing it needs a dev-server restart.
import site from './src/content/settings/site.json';

// ---------------------------------------------------------------------------
// Media bucket
// ---------------------------------------------------------------------------
// Photographs live in R2 and are uploaded through the CloudCannon DAM, so the
// bucket's public origin has to be known at BUILD time, twice over: to turn
// stored values into URLs, and to authorise Astro to download and re-encode
// them.
//
// One home, same rule as `site`: the CMS settings entry, which must match the
// Base URL of the DAM linked under Site Settings -> Assets. An env var still
// wins, which is what lets a preview deploy point at a different bucket without
// touching content. Empty is a valid state — a site with no bucket configured
// keeps rendering the images that are still in its repo.
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

// The Cloudflare adapter runs the dev server inside workerd, which has no
// filesystem and no local .env — so it is applied to BUILDS ONLY. `astro dev`
// uses Astro's own Node server, and the build produces the worker that serves
// the deployed site.
const isBuild = process.argv.includes('build');

export default defineConfig({
  site: site.siteUrl,

  // Every page of the site is prerendered to static HTML. The adapter is here
  // for the one route that cannot be: the form endpoint (/api/quote), which
  // verifies Turnstile, commits the lead to the repo and sends the email.
  //
  // This is what separates this site from test-3.com: there, CloudCannon's
  // hosting answered the form post. Here CloudCannon is in Headless Mode — it
  // edits the content and commits it, but never builds or hosts — so the
  // Worker on Cloudflare has to own the form.
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

  // No @cloudcannon/editable-regions here: Headless Mode has no CloudCannon
  // build, and the Visual Editor needs one, so the site is edited through the
  // Data and Content editors only and ships no editor markup.
  integrations: [sitemap()],

  vite: {
    plugins: [tailwindcss()],
    // The adapter pre-bundles Astro's runtime for the workerd module runner but
    // not its own server entrypoint, which Vite then discovers mid-build and
    // re-optimises ("optimized dependencies changed. reloading"). On a slow or
    // busy runner the reload can hand workerd a mixed set of chunks — CI failed
    // with `require_dist is not a function` from a chunk of the old set when
    // two adapter sites built in parallel. Declaring it up front means the
    // optimizer knows the full set before the first module runs and never
    // reloads. Build only: in dev there is no adapter and no workerd.
    ssr: isBuild
      ? { optimizeDeps: { include: ['@astrojs/cloudflare/entrypoints/server'] } }
      : undefined,
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
