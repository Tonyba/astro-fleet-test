/// <reference types="astro/client" />

/**
 * This site is fully static and has no worker, so there are no runtime secrets:
 * form posts are handled by CloudCannon's hosting (see the Inbox settings), and
 * photographs are uploaded through the CloudCannon R2 DAM rather than an
 * endpoint of ours. Contrast test-2.com, which still carries a worker and a
 * matching list of Env bindings.
 *
 * Build-time environment only. `PUBLIC_MEDIA_BASE_URL` is not set in .env for a
 * normal build: astro.config.mjs derives it from the CMS site settings and puts
 * it here, so shared-ui can resolve bucket values without importing this site's
 * content. Setting it in .env overrides that (preview deploys).
 */
interface ImportMetaEnv {
  readonly PUBLIC_MEDIA_BASE_URL?: string;
  /** Overrides the CMS Turnstile site key when testing with Cloudflare's dummy keys. */
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}
