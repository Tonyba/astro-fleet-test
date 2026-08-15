/**
 * /api/media — the CMS uploader's endpoint (on-demand, runs on the worker).
 * ---------------------------------------------------------------------------
 * Photographs no longer travel through git. The `r2Image` field posts the file
 * here, this route stores it in the bucket, and the entry keeps only the key —
 * so saving a page in Keystatic commits a one-line JSON diff instead of a
 * multi-megabyte binary.
 *
 * Bindings and secrets:
 *   MEDIA                  R2 bucket binding (production; see wrangler.jsonc)
 *   R2_ACCOUNT_ID          \
 *   R2_ACCESS_KEY_ID        }  local dev only — `astro dev` runs in Node with
 *   R2_SECRET_ACCESS_KEY    }  no bindings, so it reaches the SAME bucket over
 *   R2_BUCKET              /   R2's S3 API. Put them in .env.
 *
 * The public base is read from the committed settings file rather than from
 * D1, on purpose: this value has to match the one compiled into the build (the
 * pages resolve keys against it), and the build only ever sees the file. An
 * editor changing it in the CMS therefore takes effect on the next deploy, like
 * `siteUrl` does.
 *
 * Every request must carry a Keystatic session with push access to the repo;
 * `astro dev` is exempt because Keystatic runs in local mode there and the
 * server is not on the internet. See media-api.ts for the check itself.
 */
import type { APIRoute } from 'astro';
// Astro 6's Cloudflare adapter dropped `Astro.locals.runtime.env`; bindings and
// secrets come from this import (stubbed to `{}` in dev, see astro.config.mjs).
import { env as workerEnv } from 'cloudflare:workers';
import { createMediaHandler } from '@astro-fleet/shared-ui/src/media/media-api';
import site from '../../content/settings/site.json';

export const prerender = false;

const handler = createMediaHandler({
  // Worker bindings win; import.meta.env carries whatever a local .env set.
  env: { ...import.meta.env, ...(workerEnv as Record<string, unknown>) },
  // Same repo Keystatic commits to — a caller must be able to write to it.
  repo: (workerEnv as Record<string, string>).GITHUB_REPO ?? 'tonyba/astro-fleet-test',
  publicBase: site.business.technical.mediaBaseUrl ?? '',
  isLocal: import.meta.env.DEV,
});

export const ALL: APIRoute = ({ request }) => handler(request);
