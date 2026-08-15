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
