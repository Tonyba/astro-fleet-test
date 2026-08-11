import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import mdx from "@astrojs/mdx";

// Deploy target is env-driven so local dev stays at the root path while a
// GitHub Pages *project* build serves under a sub-path. For Pages, build with:
//   SITE_URL=https://tonyba.github.io SITE_BASE=astro-fleet-test bun run build --filter=test-1.com
// SITE_BASE is the bare repo name (NO slashes) — leading slashes get mangled by
// Git Bash on Windows, so we normalise and wrap it here.
const SITE = process.env.SITE_URL || 'https://www.test-1.com';
const rawBase = (process.env.SITE_BASE || '').replace(/^\/+|\/+$/g, '');
const BASE = rawBase ? `/${rawBase}/` : '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    sitemap({
      /* filter: (page) => page !== `https://www.test-1.com/admin/`,*/
    })
  ],
  vite: { plugins: [tailwindcss()] },
  output: 'static',
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Instrument Sans',
      cssVariable: '--font-heading',
      weights: [400, 500, 600, 700],
    },
    {
      provider: fontProviders.google(),
      name: 'Instrument Sans',
      cssVariable: '--font-body',
      weights: [400, 500, 600, 700],
    },
    {
      provider: fontProviders.google(),
      name: 'Poppins',
      cssVariable: '--font-large',
      weights: [400, 500, 600],
    },
    {
      provider: fontProviders.google(),
      name: 'Mr De Haviland',
      cssVariable: '--font-script',
      weights: [400],
    },
  ],
});
