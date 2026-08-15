/**
 * POST /api/quote  — on-demand Astro endpoint (runs on the Cloudflare worker)
 * ---------------------------------------------------------------------------
 * Receives quote/inspection form submissions, verifies the Cloudflare
 * Turnstile token, and stores the submission as a row in D1 (`submissions`).
 * /admin/leads reads it back.
 *
 * D1 IS THE ONLY STORE, AND DELIBERATELY SO. Submissions used to also be
 * committed to the repo as markdown, because that was the only way Keystatic
 * could list them — Keystatic's storage kinds are all git trees. That repo is
 * public, which meant every customer's name, email, phone number and message
 * was world-readable and indexed by GitHub code search. No view is worth that,
 * so the commit is gone and the lead inbox moved to /admin/leads.
 *
 * A failed write is now a 500 rather than a silent success: there is no second
 * store to fall back to, and the visitor needs to know their enquiry did not
 * arrive. (`astro dev` has no binding, so there it logs and accepts.)
 *
 * This used to be a Pages Function at functions/api/quote.ts. Once the
 * Cloudflare adapter emits a _worker.js, Cloudflare Pages ignores the
 * functions/ directory entirely — so the endpoint lives here instead.
 *
 * Required environment (set as worker secrets):
 *   TURNSTILE_SECRET  — Turnstile secret key (spam protection)
 *
 * Bindings:
 *   CONTENT_DB        — D1, see db/schema.sql
 */
import type { APIRoute } from 'astro';
// Astro 6's Cloudflare adapter removed `Astro.locals.runtime.env`; secrets and
// bindings come from this import now.
import { env as workerEnv } from 'cloudflare:workers';
import { getDoc } from '../../lib/runtime-content';

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

  // The one write. There is no second store to cover for it, so its failure is
  // the visitor's failure and must be reported as one — the alternative is the
  // silent `{ ok: true }` that lost leads for weeks.
  let saved = false;
  if (env.CONTENT_DB) {
    try {
      await saveToDatabase(env.CONTENT_DB, lead, request);
      saved = true;
    } catch (err) {
      console.error(`Submission ${lead.id}: D1 insert failed —`, (err as Error).message);
    }
  }

  if (!saved) {
    // `astro dev` has no binding at all, so there this logs and accepts;
    // deployed, a missing row is a 500.
    console.error(`Submission ${lead.id} NOT STORED:`, JSON.stringify(lead));
    if (!import.meta.env.DEV) {
      return jsonResponse({ ok: false, error: 'Could not save submission' }, 500);
    }
  }

  return jsonResponse({ ok: true });
};
