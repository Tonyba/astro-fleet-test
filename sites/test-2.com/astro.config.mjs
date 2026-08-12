import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// The site URL has exactly one home: `siteUrl` in the CMS site settings. Feeding
// `site` from it makes `Astro.site` — and therefore every canonical, og:url,
// sitemap and robots.txt entry — follow whatever the CMS says. Nothing that
// renders a URL may hardcode the domain.
// NOTE: this is read at config load, so changing it needs a dev-server restart.
import site from './src/content/settings/site.json';

export default defineConfig({
  site: site.siteUrl,
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
  output: 'static',
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
