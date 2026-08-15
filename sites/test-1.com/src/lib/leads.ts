/**
 * Reads and writes for the `submissions` table.
 * ---------------------------------------------------------------------------
 * D1 is the ONLY store for leads. They used to be committed to the repo as
 * markdown so Keystatic could list them, which put customer names, emails and
 * phone numbers in a public GitHub repository — readable by anyone, indexed by
 * GitHub code search. /admin/leads replaced that view; nothing about a lead
 * leaves this database now.
 *
 * Keystatic cannot be the UI here: its storage kinds are `local`, `github` and
 * `cloud`, all of them git trees, with no database adapter and (in 0.6.5) no
 * custom-field escape hatch to embed one.
 */
import { store } from './runtime-content';

/** One answer as the form endpoint stored it. */
export type Answer = { name: string; label: string; type: string; value: string };

export type Lead = {
  id: string;
  form: string;
  form_id: string;
  name: string;
  email: string;
  phone: string;
  answers: Answer[];
  received: string;
  ip: string;
  user_agent: string;
};

type Row = Omit<Lead, 'answers'> & { data: string };

const PAGE_SIZE = 50;

function toLead(row: Row): Lead {
  let answers: Answer[] = [];
  try {
    const parsed = JSON.parse(row.data);
    if (Array.isArray(parsed)) answers = parsed;
  } catch {
    // A row whose JSON will not parse still has its scalar columns, and showing
    // a lead with no answer list beats showing no lead at all.
  }
  const { data: _data, ...rest } = row;
  return { ...rest, answers };
}

/**
 * A page of leads, newest first, optionally filtered.
 *
 * The search runs over the scalar columns AND the raw `data` JSON, so it also
 * matches text inside answers — a service name, a word from the message —
 * without needing a column per field.
 */
export async function listLeads(
  search = '',
  page = 0
): Promise<{ leads: Lead[]; total: number; page: number; pages: number }> {
  const db = store();
  if (!db) return { leads: [], total: 0, page: 0, pages: 0 };

  const term = search.trim();
  const where = term ? 'WHERE name LIKE ?1 OR email LIKE ?1 OR phone LIKE ?1 OR data LIKE ?1' : '';
  const like = `%${term.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM submissions ${where}`);
  const { n: total } =
    (await (term ? countStmt.bind(like) : countStmt).first<{ n: number }>()) ?? { n: 0 };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pages - 1);

  const listStmt = db.prepare(
    `SELECT id, form, form_id, name, email, phone, data, received, ip, user_agent
       FROM submissions ${where}
      ORDER BY received DESC
      LIMIT ${PAGE_SIZE} OFFSET ${current * PAGE_SIZE}`
  );
  const { results } = await (term ? listStmt.bind(like) : listStmt).all<Row>();

  return { leads: (results ?? []).map(toLead), total, page: current, pages };
}

/** One lead, or null. */
export async function getLead(id: string): Promise<Lead | null> {
  const db = store();
  if (!db) return null;
  const row = await db
    .prepare(
      `SELECT id, form, form_id, name, email, phone, data, received, ip, user_agent
         FROM submissions WHERE id = ?1`
    )
    .bind(id)
    .first<Row>();
  return row ? toLead(row) : null;
}

/** Permanently remove a lead. There is no second copy anywhere. */
export async function deleteLead(id: string): Promise<boolean> {
  const db = store();
  if (!db) return false;
  const result = await db.prepare('DELETE FROM submissions WHERE id = ?1').bind(id).run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Every lead matching a search, for the CSV export. */
export async function allLeads(search = ''): Promise<Lead[]> {
  const collected: Lead[] = [];
  let page = 0;
  let pages = 1;
  while (page < pages) {
    const result = await listLeads(search, page);
    collected.push(...result.leads);
    pages = result.pages;
    page += 1;
    if (!result.leads.length) break;
  }
  return collected;
}

/**
 * CSV with a column per distinct question across the exported rows — the field
 * set is a CMS decision and changes over time, so the header is computed from
 * the data rather than declared.
 */
export function toCsv(leads: Lead[]): string {
  const questions: string[] = [];
  for (const lead of leads) {
    for (const answer of lead.answers) {
      if (!questions.includes(answer.label)) questions.push(answer.label);
    }
  }

  const header = ['Received', 'Form', 'Name', 'Email', 'Phone', ...questions];
  // Excel reads a leading `=`, `+`, `-` or `@` as a formula; the apostrophe
  // stops a lead's message from executing in someone's spreadsheet.
  const cell = (value: string) => {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const rows = leads.map((lead) =>
    [
      lead.received,
      lead.form,
      lead.name,
      lead.email,
      lead.phone,
      ...questions.map((q) => lead.answers.find((a) => a.label === q)?.value ?? ''),
    ]
      .map((v) => cell(String(v ?? '')))
      .join(',')
  );

  return [header.map(cell).join(','), ...rows].join('\r\n');
}
