#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Every site in this fleet is edited by CloudCannon, so a new site is a clone
# of an existing CloudCannon site rather than a blank starter: the content
# model, cloudcannon.config.yml, the media pipeline and the form endpoint all
# come along, and only the names change. The template is any site under sites/
# that carries a cloudcannon.config.yml — pass one with --template, or let the
# script pick the only one there is.
TEMPLATE_SITE=""

usage() {
  echo "Usage: ./scripts/new-site.sh <domain> [--template <site>]"
  echo ""
  echo "  domain      e.g. mydomain.com (becomes the site directory name)"
  echo "  --template  site under sites/ to clone. Optional when exactly one"
  echo "              site with a cloudcannon.config.yml exists."
  echo ""
  echo "Example:"
  echo "  ./scripts/new-site.sh acme.com --template client-a.com"
}

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

DOMAIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --template)
      [ $# -ge 2 ] || { echo "Error: --template needs a value."; exit 1; }
      TEMPLATE_SITE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Error: unknown option '$1'."; usage; exit 1 ;;
    *)
      [ -z "$DOMAIN" ] || { echo "Error: unexpected argument '$1'."; usage; exit 1; }
      DOMAIN="$1"; shift ;;
  esac
done

# Validate domain — alphanumeric, hyphens, dots only. Blocks path traversal and sed injection.
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || [[ "$DOMAIN" == *..* ]]; then
  echo "Error: Invalid domain '$DOMAIN'. Use only letters, numbers, hyphens, and dots."
  exit 1
fi

if [ -d "$ROOT_DIR/sites/$DOMAIN" ]; then
  echo "Error: sites/$DOMAIN already exists."
  exit 1
fi

# No --template: use the one CloudCannon site in the fleet, if there is exactly one.
if [ -z "$TEMPLATE_SITE" ]; then
  CANDIDATES=()
  for cfg in "$ROOT_DIR"/sites/*/cloudcannon.config.yml; do
    [ -f "$cfg" ] && CANDIDATES+=("$(basename "$(dirname "$cfg")")")
  done
  if [ ${#CANDIDATES[@]} -eq 1 ]; then
    TEMPLATE_SITE="${CANDIDATES[0]}"
  elif [ ${#CANDIDATES[@]} -eq 0 ]; then
    echo "Error: no site under sites/ carries a cloudcannon.config.yml, so there is nothing to clone."
    echo "       Add the first CloudCannon site by hand (see docs/adding-a-cms.md), then clone it."
    exit 1
  else
    echo "Error: several CloudCannon sites found (${CANDIDATES[*]}). Pass --template <site>."
    exit 1
  fi
fi

if [ ! -d "$ROOT_DIR/sites/$TEMPLATE_SITE" ]; then
  echo "Error: template sites/$TEMPLATE_SITE not found."
  exit 1
fi
if [ ! -f "$ROOT_DIR/sites/$TEMPLATE_SITE/cloudcannon.config.yml" ]; then
  echo "Error: sites/$TEMPLATE_SITE has no cloudcannon.config.yml — only CloudCannon sites can be cloned."
  exit 1
fi

# Bucket names and other dot-free identifiers: acme.com -> acme-com.
TEMPLATE_SLUG=$(echo "$TEMPLATE_SITE" | tr '.' '-' | tr '[:upper:]' '[:lower:]')
SLUG=$(echo "$DOMAIN" | tr '.' '-' | tr '[:upper:]' '[:lower:]')
# Literal forms for sed: the domain validation above only allows [A-Za-z0-9.-],
# so the dot is the only regex metacharacter that can appear.
TEMPLATE_SITE_RE=$(echo "$TEMPLATE_SITE" | sed 's/\./\\./g')
TEMPLATE_SLUG_RE=$(echo "$TEMPLATE_SLUG" | sed 's/\./\\./g')

echo "Creating site: $DOMAIN (cloned from sites/$TEMPLATE_SITE)"
echo ""

# 1. Copy the template one top-level entry at a time so build output, caches,
#    local secrets and node_modules (bun links workspace packages in there)
#    never come along.
SRC="$ROOT_DIR/sites/$TEMPLATE_SITE"
DEST="$ROOT_DIR/sites/$DOMAIN"
mkdir -p "$DEST"
for entry in "$SRC"/* "$SRC"/.[!.]*; do
  [ -e "$entry" ] || continue
  case "$(basename "$entry")" in
    node_modules|dist|.turbo|.astro|.wrangler|.env|.env.*) continue ;;
  esac
  cp -r "$entry" "$DEST/"
done

# 2. Rename every reference to the template site: the package name, the
#    canonical siteUrl in the CMS settings, the CloudCannon `source`, the
#    Worker name, the paths /api/quote commits submissions to, and the bucket
#    the comments point at. Text files only — nothing under public/media is a
#    text file that names the site.
find "$DEST" -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' -o -name '*.json' \
     -o -name '*.jsonc' -o -name '*.yml' -o -name '*.yaml' -o -name '*.md' -o -name '*.astro' \
     -o -name '*.css' -o -name '*.txt' -o -name '*.env*' \) \
  -print0 | while IFS= read -r -d '' file; do
    if grep -qF -e "$TEMPLATE_SITE" -e "$TEMPLATE_SLUG" "$file"; then
      # Dots escaped: unescaped, `acme.com` also matches `acme-com` and every
      # dot-free identifier would be renamed to the dotted domain.
      sed -i'' -e "s|$TEMPLATE_SITE_RE|$DOMAIN|g" -e "s|$TEMPLATE_SLUG_RE|$SLUG|g" "$file"
    fi
  done

# 3. Clean up sed backup files (macOS sed creates them with -i'')
find "$DEST" -name "*-e" -delete 2>/dev/null || true

echo "✓ Created sites/$DOMAIN"
echo ""
echo "Next steps:"
echo "  1. bun install                                  # register the workspace"
echo "  2. bun run build --filter=$DOMAIN               # prove it builds"
echo "  3. Give it its own media bucket. The clone still READS the template's"
echo "     bucket (mediaBaseUrl in src/content/settings/site.json), so:"
echo "       wrangler r2 bucket create $SLUG-media"
echo "       wrangler r2 bucket dev-url enable $SLUG-media"
echo "       bun run copy-media-bucket --site $DOMAIN --from $TEMPLATE_SLUG-media --to $SLUG-media --apply"
echo "     then set Site Settings -> Technical -> Media Bucket URL and replace the"
echo "     old bucket origin across src/content/ (DAM values are full URLs)."
echo "  4. In CloudCannon, create a Site on this repo's main branch:"
echo "       Details -> Source Folder:            sites/$DOMAIN"
echo "       Details -> Configuration Path:       sites/$DOMAIN/cloudcannon.config.yml"
echo "       Details -> Mode:                     Hosted"
echo "       Build   -> Install command:          cd ../.. && bun install --frozen-lockfile"
echo "       Build   -> Build command:            cd ../.. && bun run turbo build --filter=$DOMAIN"
echo "       Build   -> Output path:              dist"
echo "       Build   -> Node version:             22"
echo "       Assets  -> link the R2 bucket as a DAM (Base URL = mediaBaseUrl)"
echo "  5. Create the site's Inbox (Organization -> Inboxes) with its email targets"
echo "     and Turnstile keys; put the Inbox key and the Turnstile site key in"
echo "     sites/$DOMAIN/src/content/settings/site.json (Site Settings -> Technical)."
echo "  6. Edit sites/$DOMAIN/src/content/settings/site.json — business identity,"
echo "     siteUrl (already https://www.$DOMAIN). Attach the domain under Hosting"
echo "     once the first CloudCannon build is green."
echo ""
echo "See docs/adding-a-site.md and docs/adding-a-cms.md."
