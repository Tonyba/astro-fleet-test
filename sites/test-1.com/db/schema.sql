-- test-1.com runtime content store
-- ---------------------------------------------------------------------------
-- Content lives here rather than in KV because KV reads are cached at the edge
-- for 30-60 seconds and cannot be read fresher than that (cacheTtl's floor is
-- 30s, and Cloudflare's own docs advise against KV when you need to see a write
-- shortly after making it). A CMS edit therefore took up to a minute to appear.
--
-- D1 is a single-primary SQLite database with strongly consistent reads, so a
-- row written by the sync webhook is visible to the very next request.
--
-- Apply with:
--   wrangler d1 execute test-1-content --remote --file sites/test-1.com/db/schema.sql

CREATE TABLE IF NOT EXISTS docs (
  -- Path without extension, matching the old KV key: `settings/site`,
  -- `services/tree-removal`.
  id         TEXT PRIMARY KEY,
  -- Collection prefix (`services`) or '' for a singleton. Stored rather than
  -- derived so a listing is an indexed lookup instead of a LIKE scan.
  collection TEXT NOT NULL DEFAULT '',
  -- Final path segment — the slug used in URLs.
  slug       TEXT NOT NULL,
  -- The entry's frontmatter/JSON, serialised.
  data       TEXT NOT NULL,
  -- Rendered markdown body; empty for JSON entries and bodiless markdown.
  html       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS docs_collection ON docs (collection);

-- Single-row-per-key store for the sync generation (`ver`). Read on every
-- request to decide whether an isolate's content snapshot is still current, so
-- it is deliberately tiny.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Form submissions
-- ---------------------------------------------------------------------------
-- Leads land here FIRST, before /api/quote tries to commit them to the repo for
-- Keystatic. The two stores fail independently and for different reasons: the
-- git commit needs a GITHUB_TOKEN, network egress and a branch that still
-- exists, and when any of that was missing the lead was simply lost. A row in
-- the site's own database needs none of it.
--
-- Unlike `docs`, nothing here is derived — this table is the only copy of a
-- lead until the commit succeeds, so it is never truncated by a resync.
-- THE ANSWERS ARE JSON, NOT COLUMNS. Form fields are a CMS model
-- (src/content/forms/*.json): an editor can add "Preferred date", rename
-- `message`, or delete `service` without touching code. A column per field
-- would mean a migration per CMS edit, and — worse — the fields that had no
-- column would be silently dropped on submit, which is exactly the class of bug
-- that loses leads quietly. So `data` holds every answer as submitted, in the
-- order the CMS defines them, each with the label it was collected under.
--
-- The three scalar columns are duplicated OUT of that JSON, best-effort, purely
-- so a listing can sort and search without parsing every row. They are derived
-- and may be empty; `data` is the record.
CREATE TABLE IF NOT EXISTS submissions (
  -- Same slug used for the markdown filename, so a row and its CMS entry are
  -- trivially matched: `2026-08-15T13-23-34-513Z-jane-doe`.
  id           TEXT PRIMARY KEY,
  -- Where on the site it was submitted (`hero-quote`, `contact`, `inspection`).
  form         TEXT NOT NULL DEFAULT '',
  -- Which CMS form definition produced the fields — `forms/<form_id>`.
  form_id      TEXT NOT NULL DEFAULT '',
  -- Derived from `data` for listings: first text, email and tel field.
  name         TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  -- [{ name, label, type, value }, …] — the complete submission.
  data         TEXT NOT NULL DEFAULT '[]',
  -- ISO 8601, and a string rather than a timestamp so it sorts lexically and
  -- matches what the markdown frontmatter carries.
  received     TEXT NOT NULL,
  -- Kept for spam triage; neither is shown anywhere on the site.
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT '',
  -- 1 once the entry reached the repo. A row stuck at 0 is a lead the CMS has
  -- never seen — that is the query worth alerting on.
  synced       INTEGER NOT NULL DEFAULT 0
);

-- Newest first is the only listing anyone wants.
CREATE INDEX IF NOT EXISTS submissions_received ON submissions (received DESC);
-- Partial: the unsynced rows are the rare, interesting ones.
CREATE INDEX IF NOT EXISTS submissions_unsynced ON submissions (received) WHERE synced = 0;
