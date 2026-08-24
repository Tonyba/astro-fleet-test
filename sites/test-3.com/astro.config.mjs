import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
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

export default defineConfig({
  site: site.siteUrl,

  // Fully static — no adapter, no worker. Form posts are handled by
  // CloudCannon's hosting, which stores them against the Inbox named in
  // `business.technical.cloudcannonInboxKey`, forwards them to the inbox's
  // targets, and answers 303 to the form's action (the success page).
  // That is why this site needs no server route of its own.
  output: 'static',

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
