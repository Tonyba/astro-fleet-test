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
