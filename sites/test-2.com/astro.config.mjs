import { fileURLToPath } from 'node:url';

import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// The site URL has exactly one home: `siteUrl` in the CMS site settings. Feeding
// `site` from it makes `Astro.site` — and therefore every canonical, og:url,
// sitemap and robots.txt entry — follow whatever the CMS says. Nothing that
// renders a URL may hardcode the domain.
// NOTE: this is read at config load, so changing it needs a dev-server restart.
import site from './src/content/settings/site.json';

// The Cloudflare adapter runs the dev server inside workerd, and Keystatic's
// local storage mode refuses to run outside Node — so `astro dev` with the
// adapter loaded can never write to disk. The adapter is therefore applied to
// BUILDS ONLY: dev uses Astro's own Node server (where /keystatic edits files
// directly), and the build produces the worker that serves the deployed site.
const isBuild = process.argv.includes('build');

export default defineConfig({
  site: site.siteUrl,

  // Every page of the site is still prerendered to static HTML. The adapter is
  // here for the handful of on-demand routes that cannot be: Keystatic's admin
  // UI (/keystatic) and its GitHub API (/api/keystatic), plus the form
  // endpoint (/api/quote). Those are the only things that run on the worker.
  output: 'static',
  adapter: isBuild
    ? cloudflare({
        // Images are optimised at build time with sharp; nothing is resized at
        // runtime, so the worker needs no image service.
        imageService: 'compile',
      })
    : undefined,

  // The Keystatic admin is a React island, so react() is required. The
  // @keystatic/astro *integration* is deliberately NOT used: it injects its two
  // routes out of node_modules as a .astro entrypoint that the Cloudflare dev
  // runner cannot resolve. Those routes live in src/pages/keystatic/ and
  // src/pages/api/keystatic/ instead, importing keystatic.config.ts directly.
  integrations: [react(), sitemap()],

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
