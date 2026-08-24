import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import editableRegions from '@cloudcannon/editable-regions/astro-integration';

export default defineConfig({
  site: 'https://www.test-3.com',
  // editableRegions() powers CloudCannon's Visual Editor: it reads the
  // data-editable / data-prop attributes in src/pages/ and wires each one back
  // to its source file. Inert outside the CloudCannon preview.
  integrations: [sitemap(), editableRegions()],
  vite: { plugins: [tailwindcss()] },
  output: 'static',
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-heading',
      weights: [400, 500, 600, 700, 800, 900],
    },
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-body',
      weights: [400, 500, 600, 700],
    },
  ],
});
