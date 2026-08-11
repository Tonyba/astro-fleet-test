import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: 'https://www.test-1.com',
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
