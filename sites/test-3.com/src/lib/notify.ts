/**
 * notify.ts — lead notification email, sent through Brevo
 * ---------------------------------------------------------------------------
 * A submission is stored in D1 and committed to the repo for Keystatic, but
 * neither of those tells anyone a lead arrived. This does: one email per
 * submission to the site's contact address.
 *
 * HTTP API, NOT SMTP. Brevo advertises an SMTP relay and it cannot be used
 * here: SMTP needs a raw TCP socket to negotiate its handshake, and this code
 * runs in a V8 isolate on Cloudflare Workers, which has none. The REST endpoint
 * below is a plain `fetch`, which is also why there is no SDK dependency — the
 * whole integration is one request.
 *
 * Note the auth header: Brevo takes `api-key: <key>`, not the
 * `Authorization: Bearer <key>` most APIs use.
 *
 * BEST EFFORT, ALWAYS. Every function here swallows its own failures and
 * reports them through the return value. A submission is already durable by the
 * time this runs, so a Brevo outage, a revoked key or an unverified sender must
 * never turn a captured lead into an error for the visitor — it is an operator
 * problem, logged, and the lead is still in the database and the CMS.
 *
 * Environment (worker secrets; absent in dev, where sending is skipped):
 *   BREVO_API_KEY    — v3 API key from Brevo → SMTP & API → API Keys
 *   BREVO_FROM_EMAIL — sender address; must be a verified sender (or on a
 *                      domain authenticated) in that Brevo account
 *   BREVO_FROM_NAME  — optional display name, defaults to the site name
 */
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** One answer as submitted — the shape /api/quote already builds. */
export type Answer = { name: string; label: string; type: string; value: string };

export type Lead = {
  id: string;
  /** Placement the form was rendered in: `hero-quote`, `contact`, … */
  formName: string;
  name: string;
  email: string;
  phone: string;
  answers: Answer[];
  received: string;
};

type NotifyEnv = {
  BREVO_API_KEY?: string;
  BREVO_FROM_EMAIL?: string;
  BREVO_FROM_NAME?: string;
};

/** Escape before interpolating anything a stranger typed into the HTML body. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Answers worth showing — an unanswered optional field is noise in an inbox. */
const answered = (lead: Lead): Answer[] => lead.answers.filter((a) => a.value);

function subjectLine(lead: Lead, siteName: string): string {
  // The site name leads because one inbox may collect leads from several sites
  // in the fleet, and the sender address is the same for all of them.
  const who = lead.name || lead.email || 'new lead';
  return `[${siteName}] New form submission — ${who}`;
}

function textBody(lead: Lead, siteName: string): string {
  const lines = answered(lead).map((a) => `${a.label}: ${a.value}`);
  return [
    `New submission on ${siteName}.`,
    '',
    ...lines,
    '',
    `Form: ${lead.formName || '—'}`,
    `Received: ${lead.received}`,
    `Reference: ${lead.id}`,
  ].join('\n');
}

function htmlBody(lead: Lead, siteName: string): string {
  const rows = answered(lead)
    .map(
      (a) => `
        <tr>
          <td style="padding:8px 16px 8px 0;vertical-align:top;color:#555;white-space:nowrap;">
            ${escapeHtml(a.label)}
          </td>
          <td style="padding:8px 0;vertical-align:top;color:#111;">
            ${escapeHtml(a.value).replace(/\r?\n/g, '<br>')}
          </td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
      <h1 style="margin:0 0 4px;font-size:18px;color:#111;">New form submission</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#666;">${escapeHtml(siteName)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
      <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
        Form: ${escapeHtml(lead.formName || '—')}<br>
        Received: ${escapeHtml(lead.received)}<br>
        Reference: ${escapeHtml(lead.id)}
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Send the notification. Resolves `true` only when Brevo accepted the message;
 * every other outcome — unconfigured, rejected, network failure — resolves
 * `false` after logging, and is not an error the caller has to handle.
 */
export async function notifyLead(
  env: NotifyEnv,
  lead: Lead,
  options: { to: string; siteName: string }
): Promise<boolean> {
  const { to, siteName } = options;

  if (!env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL) {
    console.log(
      `Submission ${lead.id}: Brevo not configured (BREVO_API_KEY / BREVO_FROM_EMAIL), no email sent`
    );
    return false;
  }
  if (!to || !EMAIL.test(to)) {
    console.error(
      `Submission ${lead.id}: no valid contact email to notify (got ${JSON.stringify(to)}) — set it in Site Settings → Business → Contact`
    );
    return false;
  }

  const payload: Record<string, unknown> = {
    sender: { email: env.BREVO_FROM_EMAIL, name: env.BREVO_FROM_NAME || siteName },
    to: [{ email: to }],
    subject: subjectLine(lead, siteName),
    htmlContent: htmlBody(lead, siteName),
    textContent: textBody(lead, siteName),
  };

  // Replying to the notification should reach the customer, not the sender
  // address — but only when they actually gave a usable one, since Brevo
  // rejects the whole request over a malformed replyTo.
  if (lead.email && EMAIL.test(lead.email)) {
    payload.replyTo = lead.name
      ? { email: lead.email, name: lead.name }
      : { email: lead.email };
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(
        `Submission ${lead.id}: Brevo ${res.status} — ${(await res.text()).slice(0, 300)}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Submission ${lead.id}: Brevo request failed —`, err);
    return false;
  }
}
