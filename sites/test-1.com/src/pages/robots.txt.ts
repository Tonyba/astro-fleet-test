import type { APIRoute } from 'astro';

/**
 * robots.txt
 * ----------
 * Generated rather than shipped as a static file so the Sitemap line follows
 * `siteUrl` from the CMS settings (via `astro.config.mjs` → `Astro.site`)
 * instead of hardcoding the domain.
 */
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('sitemap-index.xml', site).href;

  return new Response(
    [
      'User-agent: *',
      'Allow: /',
      // Both are password-gated and hold customer data; keeping them out of the
      // index is belt-and-braces, not the access control.
      'Disallow: /admin',
      'Disallow: /keystatic',
      '',
      `Sitemap: ${sitemap}`,
      '',
    ].join('\n'),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } }
  );
};
