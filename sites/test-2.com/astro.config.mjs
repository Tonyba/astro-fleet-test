import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.test-2.com',
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
