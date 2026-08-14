/**
 * Dev-only stand-in for the `cloudflare:workers` module.
 *
 * The Cloudflare adapter is applied for builds only (see astro.config.mjs), so
 * during `astro dev` that module does not exist and the alias in the Vite
 * config points here instead. Nothing in dev needs real bindings: Keystatic
 * runs in local storage mode, and /api/quote falls back to `import.meta.env`,
 * which Astro fills from the site's `.env`.
 */
export const env: Record<string, string | undefined> = {};
