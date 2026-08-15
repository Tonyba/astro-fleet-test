/// <reference types="astro/client" />

/**
 * Secrets bound to the Cloudflare worker. Set these as Pages secrets in
 * production and in a local `.env` for `astro dev`.
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

  /**
   * R2 media bucket — where CMS-uploaded photographs are stored.
   *
   * In production the worker gets the `MEDIA` binding from wrangler.jsonc and
   * needs none of the keys below. `astro dev` runs in Node with no bindings at
   * all, so it reaches the same bucket over R2's S3 API using these; set them
   * in .env if you want to upload while developing locally.
   */
  MEDIA?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  /** S3 endpoint override — only for pointing tests at a local stub. */
  R2_ENDPOINT?: string;

  /* Keystatic GitHub mode — created by the GitHub App setup flow at /keystatic. */
  KEYSTATIC_GITHUB_CLIENT_ID?: string;
  KEYSTATIC_GITHUB_CLIENT_SECRET?: string;
  KEYSTATIC_SECRET?: string;
  PUBLIC_KEYSTATIC_GITHUB_APP_SLUG?: string;
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
}
