/// <reference types="astro/client" />

/**
 * Secrets bound to the Cloudflare worker. Set these as Worker secrets in
 * production and in a local `.env` for `astro dev`.
 *
 * Shorter than test-2.com's: this site is edited through CloudCannon, so there
 * is no Keystatic OAuth app and no R2 upload endpoint — the only worker route
 * is POST /api/quote.
 */
interface Env {
  /** Turnstile secret key — spam protection on /api/quote. */
  TURNSTILE_SECRET?: string;
  /** Repo-scoped token used to commit form submissions back to the repo. */
  GITHUB_TOKEN?: string;
  /** "owner/repo" for submission commits. */
  GITHUB_REPO?: string;
  /** Target branch for submission commits. */
  GITHUB_BRANCH?: string;

  /**
   * Brevo — lead notification email on /api/quote. Absent means no email is
   * sent; the submission is still stored. See src/lib/notify.ts.
   */
  BREVO_API_KEY?: string;
  /** Sender address; must be a verified sender in that Brevo account. */
  BREVO_FROM_EMAIL?: string;
  /** Optional sender display name; defaults to the site name. */
  BREVO_FROM_NAME?: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

/**
 * Build-time environment. `PUBLIC_MEDIA_BASE_URL` is not set in .env for a
 * normal build: astro.config.mjs derives it from the CMS site settings and puts
 * it here, so shared-ui can resolve `r2:<key>` values without importing this
 * site's content. Setting it in .env overrides that (preview deploys).
 */
interface ImportMetaEnv {
  readonly PUBLIC_MEDIA_BASE_URL?: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}
