/**
 * POST /api/quote  — on-demand Astro endpoint (runs on the Cloudflare worker)
 * ---------------------------------------------------------------------------
 * Receives quote/inspection form submissions, verifies the Cloudflare
 * Turnstile token, persists the submission TWICE, then emails it out:
 *
 *   1. a row in D1 (`submissions`)  — the durable store, written first
 *   2. a markdown entry in the repo — what Keystatic's "Form Submissions"
 *                                     collection reads
 *   3. a notification to the site's contact address, via Brevo (see notify.ts)
 *
 * Two stores because they fail for different reasons and a lost lead is the
 * one unacceptable outcome here. The commit needs GITHUB_TOKEN, network egress
 * to api.github.com and a branch that still exists; when the token was missing
 * this endpoint returned `{ ok: true }` and dropped the lead on the floor.
 * The database needs a binding this worker already has. So D1 goes first and
 * decides the response: if the row is written the visitor gets their
 * confirmation, and a failed commit is an operator problem (a `synced = 0` row)
 * rather than a lost customer.
 *
 * This used to be a Pages Function at functions/api/quote.ts. Once the
 * Cloudflare adapter emits a _worker.js, Cloudflare Pages ignores the
 * functions/ directory entirely — so the endpoint lives here instead.
 *
 * Required environment (set as worker secrets):
 *   TURNSTILE_SECRET  — Turnstile secret key (spam protection)
 *   GITHUB_TOKEN      — repo-scoped token used to commit submissions
 *   GITHUB_REPO       — "owner/repo" (defaults to tonyba/astro-fleet-test)
 *   GITHUB_BRANCH     — target branch (defaults to main)
 *   BREVO_API_KEY     — lead notification email; skipped when unset
 *   BREVO_FROM_EMAIL  — verified Brevo sender address
 *
 * Bindings:
 *   CONTENT_DB        — D1, see db/schema.sql
 */
import type { APIRoute } from 'astro';
// Astro 6's Cloudflare adapter removed `Astro.locals.runtime.env`; secrets and
// bindings come from this import now.
import { env as workerEnv } from 'cloudflare:workers';
import { dump as dumpYaml } from 'js-yaml';
import { getDoc } from '../../lib/runtime-content';
import { notifyLead } from '../../lib/notify';

export const prerender = false;

/** Inputs the form machinery owns; never stored as answers. */
const RESERVED = new Set(['form_name', 'form_id', 'cf-turnstile-response']);

/** Caps for a submission with no form definition to check it against. */
const MAX_FIELDS = 40;
const MAX_VALUE_LENGTH = 5_000;

/** One field as the CMS defines it (mirrors TreeQuoteForm's FieldDef). */
type FieldDef = {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  options?: string[];
};

/** One answer as submitted, carrying enough context to be read years later. */
type Answer = { name: string; label: string; type: string; value: string };

/**
 * A submission, resolved. `answers` is the record; `name`/`email`/`phone` are
 * pulled out of it for listings and for the filename, and may be empty if the
 * form does not ask for them.
 */
type Lead = {
  id: string;
  /** Placement the form was rendered in: `hero-quote`, `contact`, … */
  formName: string;
  /** CMS definition it came from: `forms/<formId>`. */
  formId: string;
  name: string;
  email: string;
  phone: string;
  answers: Answer[];
  received: string;
};

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

// ---------------------------------------------------------------------------
// Collecting the answers
// ---------------------------------------------------------------------------
/**
 * The field list for this form, straight from the CMS entry the form was
 * rendered from, or null when the submission carries no `form_id` (a form built
 * from literal props) or the entry has gone missing.
 */
async function loadFormFields(formId: string): Promise<FieldDef[] | null> {
  if (!formId || !/^[a-z0-9-]+$/i.test(formId)) return null;
  try {
    const form = await getDoc<{ fields?: FieldDef[] }>(`forms/${formId}`);
    return Array.isArray(form?.fields) && form.fields.length ? form.fields : null;
  } catch {
    // getDoc throws for an unknown id. A submission is not the place to care:
    // fall through to accepting what was posted.
    return null;
  }
}

/**
 * Turn the POST into an ordered list of answers.
 *
 * WITH a definition, the definition decides: every field it declares is
 * collected, in its order, under its label — so a field added in the CMS is
 * stored the moment it is added, and junk injected into the POST is ignored.
 * WITHOUT one, everything submitted is kept (capped), because dropping a
 * visitor's answer is worse than storing a field we cannot describe.
 */
function collectAnswers(form: FormData, fields: FieldDef[] | null): Answer[] {
  const read = (name: string) => {
    // getAll: checkbox groups and multi-selects submit one entry per choice.
    const values = form.getAll(name).map((v) => String(v).trim()).filter(Boolean);
    return values.join(', ').slice(0, MAX_VALUE_LENGTH);
  };

  if (fields) {
    return fields
      .filter((field) => field?.name)
      .map((field) => ({
        name: field.name,
        label: field.label || field.name,
        type: field.type || 'text',
        value: read(field.name),
      }));
  }

  const answers: Answer[] = [];
  for (const name of new Set(form.keys())) {
    if (RESERVED.has(name) || answers.length >= MAX_FIELDS) continue;
    answers.push({ name, label: name, type: 'text', value: read(name) });
  }
  return answers;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate against the CMS definition — `required`, the option lists and the
 * field types are all editable there, so this cannot be a fixed rule set.
 *
 * The browser checks the same things first; this is the copy that matters,
 * since a POST need not come from the form. Returns the offending labels.
 */
function validate(answers: Answer[], fields: FieldDef[] | null): string[] {
  if (!fields) return [];
  const byName = new Map(fields.map((field) => [field.name, field]));
  const problems: string[] = [];

  for (const answer of answers) {
    const field = byName.get(answer.name);
    if (!field) continue;

    if (!answer.value) {
      if (field.required) problems.push(field.label || field.name);
      continue; // Nothing further to check about an empty optional field.
    }
    if (field.type === 'email' && !EMAIL.test(answer.value)) {
      problems.push(field.label || field.name);
    }
    if (field.type === 'tel' && (answer.value.match(/\d/g) ?? []).length < 6) {
      problems.push(field.label || field.name);
    }
    if (
      (field.type === 'select' || field.type === 'radio') &&
      field.options?.length &&
      !answer.value.split(', ').every((v) => field.options!.includes(v))
    ) {
      problems.push(field.label || field.name);
    }
  }

  return problems;
}

/** First answer of a given type — how the listing columns get filled. */
const firstOfType = (answers: Answer[], ...types: string[]): string =>
  answers.find((a) => types.includes(a.type) && a.value)?.value ?? '';

/**
 * Filename-safe id, shared by the database row and the markdown entry so the
 * two copies of a lead can be matched by eye.
 */
function submissionId(fullName: string, received: string): string {
  const stamp = received.replace(/[:.]/g, '-');
  const name = (fullName || 'lead').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return `${stamp}-${name}`;
}

/**
 * The durable write. Runs before the commit and, unlike it, is not optional:
 * its failure is what turns a submission into a 500.
 */
async function saveToDatabase(
  db: D1Database,
  lead: Lead,
  request: Request
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO submissions
         (id, form, form_id, name, email, phone, data, received, ip, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
    .bind(
      lead.id,
      lead.formName,
      lead.formId,
      lead.name,
      lead.email,
      lead.phone,
      JSON.stringify(lead.answers),
      lead.received,
      request.headers.get('CF-Connecting-IP') ?? '',
      (request.headers.get('User-Agent') ?? '').slice(0, 500)
    )
    .run();
}

/** Flip a row to synced once its markdown entry is in the repo. */
async function markSynced(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE submissions SET synced = 1 WHERE id = ?1').bind(id).run();
}

async function commitSubmission(env: Env, lead: Lead): Promise<void> {
  const repo = env.GITHUB_REPO || 'tonyba/astro-fleet-test';
  const branch = env.GITHUB_BRANCH || 'main';
  const path = `sites/test-1.com/src/content/submissions/${lead.id}.md`;

  // The answers go into an `answers` ARRAY, not into frontmatter keys named
  // after the fields. Keystatic validates an entry against its collection
  // schema and refuses to open one carrying a key the schema does not declare
  // ("Key on object value is not allowed") — so a field added in the CMS would
  // produce entries the CMS itself could not display. An array of
  // {name,label,type,value} is one fixed schema that holds any field list.
  //
  // The longest free-text answer becomes the markdown body, where a paragraph
  // of prose is actually readable; it is dropped from the array so it is not
  // stored twice.
  const body = lead.answers
    .filter((a) => a.type === 'textarea' && a.value)
    .sort((a, b) => b.value.length - a.value.length)[0];

  const frontmatter = [
    '---',
    dumpYaml(
      {
        name: lead.name || 'Lead',
        form: lead.formName,
        form_id: lead.formId,
        email: lead.email,
        phone: lead.phone,
        received: lead.received,
        answers: lead.answers.filter((a) => a !== body),
      },
      // Quote every string so YAML never coerces one — `received` in
      // particular must stay a string for Keystatic's text field to read it.
      { forceQuotes: true, lineWidth: -1 }
    ).trimEnd(),
    '---',
    '',
    (body?.value ?? '').replace(/\r?\n/g, '\n'),
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
    // `lead.id`, not `id` — a bare `id` here was a ReferenceError that failed
    // every commit while the D1 write still succeeded, so leads landed in the
    // database and never in the CMS.
    body: JSON.stringify({ message: `chore(lead): ${lead.id}`, content, branch }),
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} for ${path}: ${(await res.text()).slice(0, 300)}`);
  }
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

  // What this form currently asks is a CMS decision, so read it rather than
  // assume it. Everything downstream — validation, both stores — follows from
  // the definition the form was rendered from.
  const formId = String(form.get('form_id') ?? '').trim();
  const fields = await loadFormFields(formId);
  const answers = collectAnswers(form, fields);

  const problems = validate(answers, fields);
  if (problems.length) {
    return jsonResponse(
      { ok: false, error: `Please check these fields: ${problems.join(', ')}` },
      400
    );
  }
  if (!answers.some((a) => a.value)) {
    return jsonResponse({ ok: false, error: 'Empty submission' }, 400);
  }

  const received = new Date().toISOString();
  const name = firstOfType(answers, 'text');
  const lead: Lead = {
    id: submissionId(name, received),
    formName: String(form.get('form_name') ?? '').trim(),
    formId,
    name,
    email: firstOfType(answers, 'email'),
    phone: firstOfType(answers, 'tel'),
    answers,
    received,
  };

  // 1. Database first — this is the write that must not be lost.
  let saved = false;
  if (env.CONTENT_DB) {
    try {
      await saveToDatabase(env.CONTENT_DB, lead, request);
      saved = true;
    } catch (err) {
      console.error(`Submission ${lead.id}: D1 insert failed —`, err);
    }
  }

  // 2. Repo second, so the lead shows up in Keystatic. A failure here is
  // recoverable — the row is already safe and carries `synced = 0` to say so —
  // so it must not cost the visitor their confirmation.
  let committed = false;
  if (env.GITHUB_TOKEN) {
    try {
      await commitSubmission(env, lead);
      committed = true;
      if (saved && env.CONTENT_DB) await markSynced(env.CONTENT_DB, lead.id);
    } catch (err) {
      console.error(`Submission ${lead.id}: GitHub commit failed —`, err);
    }
  } else {
    console.error(`Submission ${lead.id}: GITHUB_TOKEN is not configured, not committed to the repo`);
  }

  // Nothing kept it. `astro dev` has neither store, so log-and-accept stays the
  // dev behaviour; deployed, this is the 500 that used to be a silent success.
  if (!saved && !committed) {
    console.error(`Submission ${lead.id} DROPPED — no store accepted it:`, JSON.stringify(lead));
    if (!import.meta.env.DEV) {
      return jsonResponse({ ok: false, error: 'Could not save submission' }, 500);
    }
  }

  // 3. Tell somebody. Last, and best-effort by construction: the lead is
  // already durable, so a Brevo failure is logged and never reaches the
  // visitor. `preloadSettings()` deliberately skips /api/*, so the contact
  // address is read straight from the store rather than the settings holder.
  try {
    const site = await getDoc<{
      siteName: string;
      business: { contact: { email: string } };
    }>('settings/site');
    await notifyLead(env, lead, {
      to: site.business.contact.email,
      siteName: site.siteName,
    });
  } catch (err) {
    console.error(`Submission ${lead.id}: could not send notification —`, err);
  }

  return jsonResponse({ ok: true });
};
