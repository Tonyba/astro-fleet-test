/**
 * POST /api/quote  — on-demand Astro endpoint (runs on the Cloudflare worker)
 * ---------------------------------------------------------------------------
 * Receives quote/inspection form submissions, verifies the Cloudflare
 * Turnstile token, and persists the submission as a markdown entry in the
 * repo (surfaced as the "Form Submissions" collection in Keystatic).
 *
 * This used to be a Pages Function at functions/api/quote.ts. Once the
 * Cloudflare adapter emits a _worker.js, Cloudflare Pages ignores the
 * functions/ directory entirely — so the endpoint lives here instead.
 *
 * Required environment (set as Pages secrets):
 *   TURNSTILE_SECRET  — Turnstile secret key (spam protection)
 *   GITHUB_TOKEN      — repo-scoped token used to commit submissions
 *   GITHUB_REPO       — "owner/repo" (defaults to tonyba/astro-fleet-test)
 *   GITHUB_BRANCH     — target branch (defaults to main)
 *
 * If GITHUB_TOKEN is absent the submission is accepted and logged only, so the
 * form still works before the storage secret is configured.
 */
import type { APIRoute } from 'astro';
// Astro 6's Cloudflare adapter removed `Astro.locals.runtime.env`; secrets and
// bindings come from this import now.
import { env as workerEnv } from 'cloudflare:workers';

export const prerender = false;

const FIELDS = ['form_name', 'full_name', 'email', 'phone', 'project_type', 'service', 'message'] as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
}

async function commitSubmission(env: Env, record: Record<string, string>): Promise<void> {
  const repo = env.GITHUB_REPO || 'tonyba/astro-fleet-test';
  const branch = env.GITHUB_BRANCH || 'main';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = `${stamp}-${(record.full_name || 'lead').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  const path = `sites/test-2.com/src/content/submissions/${slug}.md`;

  // Every value is quoted so YAML never coerces it — `received` in particular
  // must stay a string, which is what Keystatic's text field expects to read.
  const q = (v: string) => `"${(v || '').replace(/"/g, "'")}"`;
  const frontmatter = [
    '---',
    `name: ${q(record.full_name)}`,
    `form: ${q(record.form_name)}`,
    `email: ${q(record.email)}`,
    `phone: ${q(record.phone)}`,
    `project_type: ${q(record.project_type)}`,
    `service: ${q(record.service)}`,
    `received: ${q(new Date().toISOString())}`,
    '---',
    '',
    (record.message || '').replace(/\r?\n/g, '\n'),
    '',
  ].join('\n');

  // UTF-8 safe base64 for the GitHub Contents API.
  const bytes = new TextEncoder().encode(frontmatter);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  const content = btoa(binary);
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'erick-tree-service-forms',
    },
    body: JSON.stringify({ message: `chore(lead): ${slug}`, content, branch }),
  });
  if (!res.ok) throw new Error(`GitHub commit failed: ${res.status}`);
}

export const POST: APIRoute = async ({ request }) => {
  // Worker secrets win; import.meta.env covers anything set only in a local
  // .env during `astro dev`.
  const env = { ...import.meta.env, ...workerEnv } as unknown as Env;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid form data' }, 400);
  }

  // Spam check (only enforced when a secret is configured).
  if (env.TURNSTILE_SECRET) {
    const token = String(form.get('cf-turnstile-response') || '');
    const ip = request.headers.get('CF-Connecting-IP');
    if (!token || !(await verifyTurnstile(env.TURNSTILE_SECRET, token, ip))) {
      return jsonResponse({ ok: false, error: 'Failed anti-spam verification' }, 400);
    }
  }

  const record: Record<string, string> = {};
  for (const key of FIELDS) record[key] = String(form.get(key) ?? '').trim();

  if (!record.full_name || !record.email || !record.phone) {
    return jsonResponse({ ok: false, error: 'Missing required fields' }, 400);
  }

  try {
    if (env.GITHUB_TOKEN) {
      await commitSubmission(env, record);
    } else {
      console.log('New lead (no GITHUB_TOKEN configured):', JSON.stringify(record));
    }
  } catch (err) {
    console.error('Failed to persist submission:', err);
    return jsonResponse({ ok: false, error: 'Could not save submission' }, 500);
  }

  return jsonResponse({ ok: true });
};
