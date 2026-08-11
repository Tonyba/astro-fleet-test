#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build test-1.com for GitHub Pages (project site under a sub-path) and sync
# the output into /docs, which Pages serves from (main branch, /docs folder).
#
# Fixes the two classic "no styles on Pages" problems:
#   1. base path  — Astro emits asset links under /astro-fleet-test/ so they
#      resolve correctly at https://tonyba.github.io/astro-fleet-test/
#   2. .nojekyll   — stops Jekyll from dropping the _astro/ folder
# ---------------------------------------------------------------------------
set -euo pipefail
export MSYS_NO_PATHCONV=1              # stop Git Bash rewriting URL-ish values

REPO_NAME="astro-fleet-test"          # GitHub repo name = the Pages sub-path (NO slashes)
GH_USER="tonyba"                      # GitHub user/org (lowercase)

cd "$(dirname "$0")/.."               # repo root

echo "▶ Building test-1.com with base /$REPO_NAME/ ..."
SITE_URL="https://$GH_USER.github.io" SITE_BASE="$REPO_NAME" \
  bun run build --filter=test-1.com

echo "▶ Syncing dist → docs/ ..."
rm -rf docs/_astro                    # clear stale hashed assets
cp -R sites/test-1.com/dist/. docs/   # copy the fresh build over docs/
touch docs/.nojekyll                  # tell Pages to publish _astro/

echo "✓ Done. Commit & push docs/, then Pages serves:"
echo "  https://$GH_USER.github.io/$REPO_NAME/"
