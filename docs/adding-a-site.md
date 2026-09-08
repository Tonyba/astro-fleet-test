# Adding a Site

Every site in this fleet is edited and hosted by [CloudCannon](https://cloudcannon.com). A new site is a **clone of an existing CloudCannon site**, not a blank starter: the content model, the CMS configuration, the media pipeline and the form wiring all come along, and the only thing left to do is rename, connect and re-point.

**If the fleet has no site yet**, there is nothing to clone: build the first one by hand following the layout in [adding-a-cms.md](./adding-a-cms.md) (or restore one from git history — `git log --all -- sites/` lists every site the repo has held; `test-3.com` was the last CloudCannon-hosted one), then clone every later site from it.

## 1. Run the scaffolding script

```bash
./scripts/new-site.sh <domain> [--template <site>]
# or, cross-platform:
bunx create-astro-fleet add <domain> [--template <site>]
```

`--template` is any directory under `sites/` that carries a `cloudcannon.config.yml`. When exactly one exists it is inferred.

**What the script does:**

1. Copies `sites/<template>/` into `sites/<domain>/`, leaving `node_modules`, `dist`, caches and `.env` behind.
2. Rewrites every reference to the template in the clone's text files:
   - `<template>` → `<domain>` — package name, `siteUrl` in `src/content/settings/site.json`, the CloudCannon `source`, comments.
   - `<template slug>` → `<domain slug>` (dots become hyphens) — the bucket name and any other dot-free identifier.

After running it:

```bash
bun install                              # register the new workspace package
bun run build --filter=<domain>          # prove it builds before touching anything else
```

## 2. Give it its own media bucket

Photographs are not in git. Content files hold **fully qualified URLs** into an R2 bucket, and the clone still points at the template's bucket (`mediaBaseUrl` in `src/content/settings/site.json`). It will build and render from there, but uploads made through the new site's CMS must land in a bucket of its own.

```bash
wrangler r2 bucket create <slug>-media
wrangler r2 bucket dev-url enable <slug>-media          # -> https://pub-<hash>.r2.dev
bun run copy-media-bucket --site <domain> --from <template-slug>-media --to <slug>-media          # dry run
bun run copy-media-bucket --site <domain> --from <template-slug>-media --to <slug>-media --apply
```

`copy-media-bucket` copies only the objects the content references and (with `--repoint <url>`) switches `mediaBaseUrl`. **It does not rewrite the URLs inside content files** — the DAM writes full URLs, so replace the old origin across `src/content/` yourself, or none of the photos will be recognised as bucket values:

```bash
grep -rl 'pub-<old-hash>.r2.dev' sites/<domain>/src/content | xargs sed -i 's|https://pub-<old-hash>.r2.dev|https://pub-<new-hash>.r2.dev|g'
```

Rebuild to confirm every image still resolves. A missing object is a failed build, not a broken image.

## 3. Connect the CloudCannon Site

In CloudCannon, create a Site on this repository's `main` branch. Under the Site (not the Organization):

| Setting | Value |
| --- | --- |
| Details → Source Folder | `sites/<domain>` |
| Details → CloudCannon Configuration Path | `sites/<domain>/cloudcannon.config.yml` |
| Details → Mode | Hosted |
| Build → Install command | `cd ../.. && bun install --frozen-lockfile` |
| Build → Build command | `cd ../.. && bun run turbo build --filter=<domain>` |
| Build → Output path | `dist` |
| Build → Node version | 22 |
| Assets | Link the R2 bucket as a DAM. Base URL **must equal** `business.technical.mediaBaseUrl` in `site.json` |

Everything the editors see — sidebar groups, collections, input types, "+ Add" structures — is described by `cloudcannon.config.yml`; there is nothing to click through beyond the table above. `cloudcannon sites print-last-failed-build --site <domain>` shows the log if the first build goes red.

## 4. Create the Inbox and set the keys

Forms post natively to a CloudCannon **Inbox**. Create one for the site (Organization → Inboxes), add its targets (the email addresses that should receive leads), and configure Turnstile on it with your own keys. Then set, in the CMS under Site Settings → Technical:

| Setting | Holds |
| --- | --- |
| Inbox key (`business.technical.cloudcannonInboxKey`) | The Inbox's key — injected into every form as the `inboxKey` prop |
| Turnstile site key | The public half; the secret goes on the Inbox |

The Turnstile widget's allowed hostnames must include the CloudCannon preview domain and the custom domain. Every site needs a `/thank-you/` page — CloudCannon answers the post with a 303 to it.

## 5. Attach the domain

Once the first build is green, attach the custom domain under the Site's Hosting settings and point DNS at CloudCannon. `siteUrl` in `site.json` must be the canonical origin — every canonical tag, `og:url`, sitemap entry and robots line follows it.

## 6. Edit the site's identity

`src/lib/site-config.ts` only re-exports values from the content files below; it is not where identity is edited. Identity, contact details, SEO patterns, theme and the header/footer menus are all content, so editors own them:

| File | CMS location | Holds |
| --- | --- | --- |
| `src/content/settings/site.json` | Site Settings | `siteUrl`, name, logo, favicon, business identity, contact, SEO title patterns, `mediaBaseUrl`, Inbox key, Turnstile site key |
| `src/content/settings/header-footer.json` | Header & Footer | Menus (with submenus), footer columns, social links |
| `src/content/global/*.json` | Global Sections | Sections rendered identically on every page that uses them |
| `src/content/homepage/home.json`, `src/content/pages/*.json` | Pages | Per-page sections and SEO |
| `src/content/services/`, `locations/`, `posts/` | Content | Collections; filename is the slug; new entries come from `.cloudcannon/schemas/` and start as drafts |
| `src/content/forms/*.json` | Forms | Reusable form definitions: fields, labels, placeholders, types |

Edit them through CloudCannon once the Site is connected, or directly in git before it is.

---

## Overriding a shared component locally

Shared components in `packages/shared-ui/src/components/` are used by all sites. If you need a one-off customisation for a single site, copy the component into the site's own component directory:

```bash
cp packages/shared-ui/src/components/TreeHero.astro \
   sites/<domain>/src/components/TreeHero.astro
```

Then update the import in the page that uses it:

```ts
// Before (resolves to shared-ui)
import TreeHero from '@astro-fleet/shared-ui/src/components/TreeHero.astro';

// After (resolves to the local copy)
import TreeHero from '../components/TreeHero.astro';
```

Astro resolves imports at build time — the local file wins. Other sites are unaffected.

---

## Selective builds

Build only the site you are working on:

```bash
bun run build --filter=<domain>
```

Build all sites:

```bash
bun run build
```

Turborepo caches build outputs. If nothing has changed in a site or its dependencies, the cache is replayed and the build completes instantly. Note that Turborepo's strict env mode drops any variable not declared under `env` in `turbo.json` — run `bunx astro build` inside the site when you need to pass one through.

---

## Running multiple dev servers

Each dev server needs its own port. Pass Astro's `--port` flag after `--`:

```bash
# Terminal 1
bun run dev --filter=<domain> -- --port 4321

# Terminal 2
bun run dev --filter=<other-domain> -- --port 4322
```
