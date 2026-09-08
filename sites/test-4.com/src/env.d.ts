/// <reference types="astro/client" />

/**
 * Secrets bound to the Cloudflare worker. Set them on the Worker in
 * production (`wrangler secret put <NAME> --name test-4-com`) and in a local
 * `.env` for `astro dev`.
 *
 * The worker exists for one route, POST /api/quote. Photographs never pass
 * through it: CloudCannon's R2 DAM uploads them to the bucket directly, so
 * unlike test-2.com there is no MEDIA binding and no R2 credential here.
 */
interface Env {
  /** Turnstile secret key — spam protection on /api/quote. */
  TURNSTILE_SECRET?: string;
  /** Repo-scoped token used to commit form submissions back to the repo. */
  GITHUB_TOKEN?: string;
  /** "owner/repo" for submission commits. */
  GITHUB_REPO?: string;
  /** Target branch for submission commits — the branch CloudCannon edits. */
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
 * it here, so shared-ui can resolve bucket values without importing this site's
 * content. Setting it in .env overrides that (preview deploys).
 */
interface ImportMetaEnv {
  readonly PUBLIC_MEDIA_BASE_URL?: string;
  /** Overrides the CMS Turnstile site key when testing with Cloudflare's dummy keys. */
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}
