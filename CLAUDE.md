# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Astro Fleet is a multi-site Astro monorepo for agencies and multi-brand companies. Each site lives in `sites/<domain>/` and is independently deployable. Shared components and config live in `packages/`.

**Stack:** Astro 6, Bun, Turborepo 2, Tailwind CSS 4, TypeScript (strict mode). Static-first — zero client-side JS by default. Fonts are self-hosted via the Astro 6 Fonts API (configured in each site's `astro.config.mjs`, no third-party Google Fonts requests).

**CMS and hosting: CloudCannon, and only CloudCannon.** CloudCannon is a hosted, git-based CMS: editors work in CloudCannon's UI, every save is a commit to this repository, and **CloudCannon builds and hosts every site** from that branch. There is no admin route in the site, no CMS code in the build, no Cloudflare Worker or Pages project and nothing to deploy from a terminal. What editors see is described entirely by one YAML file per site, `sites/<domain>/cloudcannon.config.yml`. Do not add Keystatic, Payload, Sveltia or any other per-site CMS, and do not add a Cloudflare adapter or deploy step; every site that ran one was removed from the fleet on 2026-09-08. The only Cloudflare product still in use is R2, as the media bucket behind the CloudCannon DAM.

**Fleet state:** as of 2026-09-08 `sites/` is empty. The former sites (`test-2.com` Keystatic on a Worker, `test-3.com` CloudCannon-hosted, `test-4.com` CloudCannon Headless on a Worker, plus the blank starter) were deleted from the repo; their CloudCannon Sites and R2 buckets may still exist in the accounts. `packages/shared-ui` still carries the `Tree*` component family, the media pipeline and the form component those sites used, and `git log --all -- sites/` has every one of them — `test-3.com` is the closest match to the layout below.

### How a site connects to CloudCannon (Hosted mode)

| Setting | Value |
| --- | --- |
| Site branch | `main` |
| Details → Source Folder | `sites/<domain>` |
| Details → CloudCannon Configuration Path | `sites/<domain>/cloudcannon.config.yml` |
| Details → Mode | Hosted (the default) |
| Build → Install command | `cd ../.. && bun install --frozen-lockfile` |
| Build → Build command | `cd ../.. && bun run turbo build --filter=<domain>` |
| Build → Output path | `dist` |
| Build → Node version | 22 |
| Assets | Link the site's R2 bucket as a DAM; Base URL equal to `business.technical.mediaBaseUrl` in `site.json` |
| Forms | An Inbox per site; its key goes in Site Settings → Technical (`business.technical.cloudcannonInboxKey`) |

The `cd ../..` matters: bun must install from the monorepo root for the `workspace:*` dependencies on `@astro-fleet/*` to resolve. `sites/<domain>/.cloudcannon/preinstall` installs bun, which CloudCannon's image lacks. Every path inside the config is relative to the site directory. Editors get the Data, Content **and Visual** editors; forms post natively to the Inbox; the site is fully static (`output: 'static'`, no adapter, plain `dist/`).

New sites are clones of an existing CloudCannon site (`./scripts/new-site.sh <domain> [--template <site>]` or `bunx create-astro-fleet add <domain>`); with no site in the fleet the first one is built by hand following `docs/adding-a-cms.md`.

## Main development rules
- use figma-design-to-code skill if necessary
- Use figma mcp and figma skills if necessary
- FAQs accordion elements must have faqs schema
- Always keep in mind performance, accessibility, SEO best practices.
- Use Brave as default browser
- One dev instance at a time, on port 4321 unless it is taken — do not ask which port
- Kill dev server after you are done using it
- The implementation must be pixel-perfect (1:1) compared to the Figma design.
- Do not redesign, reinterpret, or improve anything. Reproduce exactly what is in Figma.
- Use semantic HTML5 structure (header, nav, section, main, footer, etc.).
- Use taildwind for css. Minimal vanilla JavaScript only.
- Menus can have submenus
- The layout must be fully responsive:
    * Desktop (default styles)
    * Tablet (max-width: 1024px)
    * Mobile (max-width: 767px)
- Use Flexbox and/or CSS Grid where appropriate.
- Maintain exact:
    * spacing
    * font sizes
    * font weights
    * colors
    * border radius
    * shadows
    * line heights
- Extract reusable design tokens into global reusable sites ui/layout, utils folder depending on which file must be used:
    * colors
    * font sizes
    * spacing
- All elements inside a section that are repeatable (ex: accordion items, tabs, carousel items, etc.) must be editable from CMS too
- The CMS sidebar is `collection_groups` in `cloudcannon.config.yml`. Keep the fixed headings: **Pages**, **Content**, **Global Sections**, **Header & Footer**, **Forms**, **Settings**. Create "Global Sections" if it doesn't exist.
- All sections or ui elements used in other pages for new created pages or edited pages if they got any section that look the same they must be reused and added in "Global Sections" (`src/content/global/*.json`).
- Header & Footer sections must be added in cms sidebar with title "Header & Footer" (`src/content/settings/header-footer.json`).
- Images must use proper <img> tags with descriptive alt attributes.
- Follow modern CSS best practices. Navbar Requirements:
* On desktop: standard horizontal navigation layout.
* On tablet and mobile (max-width: 1024px):
    * Replace navigation links with a hamburger button.
    * The hamburger must toggle the visibility of the navigation menu.
    * The menu must expand/collapse smoothly (CSS transition required).
    * Use minimal vanilla JavaScript for toggle functionality.
    * The menu must be accessible (aria-expanded, proper button element).
    * The menu must be offcanvas.
    * No external libraries.
- any reusable ui section or layout must be save in packages/shared-ui following same format used in files already there
- all media files must be saved in public/media
- Do not add features that are not present in the Figma design.
- If spacing or font size is unclear, calculate proportionally from the design instead of guessing.
- If something from the Figma link cannot be accessed, state what is missing before generating code.
- Output only the code. No explanations.
- All texts, links, button links, images, website logo, website favicon or videos must be editable from cms
- all menus (header, footer) must be editable from cms
- all global colors and fonts must be editable from cms if posible
- all media files must be saved in media files path
- Skip `bun run lint`. Do NOT skip verification — see "Verify before reporting" below.
- when asked for corrections or edits remember that you must follow figma design if links provided, IT MUST BE RESPONSIVE and also FOCUS ONLY IN MENTIONED SECTIONS OR UI ELEMENTS IF MENTIONED

## Working autonomously

Decide and proceed. Do not come back for input on things that can be inferred from the design, the existing code, or these rules.

- **Pick the option consistent with the existing code**, state the assumption in the final summary, and keep going. Reserve questions for decisions that change the deliverable and cannot be inferred — URL structure, page hierarchy, content-model shape — and ask them all at once, before building.
- **Fix root causes, including pre-existing bugs found on the way.** Do not route around a broken thing and report it as blocked. Say what was broken and what was fixed.
- **Never say something works without having run it.** "Should work" is not a result.
- When a change spans many files (new content model, new route family, renamed field), finish every part: content JSON/markdown + `cloudcannon.config.yml` (inputs, structures, sidebar group) + `src/content.config.ts` schema + pages/components (+ `data-editable` bindings where the section is visually editable). A half-wired feature is worse than none.

## Verify before reporting

Every change to a content model, CMS config, route, or shared component gets verified before it is reported as done:

1. `bun run build --filter=<domain>` — catches schema errors, broken routes and missing assets. Confirm the expected pages exist in `dist/`.
2. Or run the dev server and `curl` the touched routes: expect `200` **and** grep the HTML for the text/markup that should have changed.
3. For CMS work the CloudCannon UI cannot be driven from here, so prove the shape instead: edit the content file exactly the way CloudCannon would write it (JSON; bare, unquoted YAML frontmatter for markdown), rebuild, confirm the rendered page changes, then revert the test value. Read the YAML back after editing it and check the three-way table below. `cloudcannon validate` (the CLI, `@cloudcannon/cli`) checks the config file's syntax; `cloudcannon sites print-last-failed-build --site <domain>` shows why CloudCannon's own build broke after a push.

Verifying is not optional and does not need permission. Never ask the user to run the app to find out whether the change worked.

## CloudCannon — read before touching cloudcannon.config.yml or content files

These are failure modes that have already cost hours. Most are silent: the build passes and an input in the CMS is simply dead or wrong.

- **Three files must agree: the content file, `cloudcannon.config.yml`, and `src/content.config.ts`.** The content holds the data; the YAML says what editors can see and add; the zod schema says what the build accepts. Adding a section means all three in the same change.
- **CloudCannon picks the input type from the KEY NAME when nothing says otherwise.** A key called `number` becomes a numeric input and silently turns `"01"` into `1`. Declare such keys `type: text` under `_inputs` — phone numbers, zero-padded step numbers, anything that is text that looks like a number.
- **An array that can be empty MUST name a structure** (`_inputs.<key>.options.structures: _structures.<name>`). Without one CloudCannon cannot infer an entry, marks the input misconfigured and "+ Add" does nothing. Arrays that are always populated infer from their items and are left alone.
- **`_inputs` are keyed by name, globally and per collection.** A global input applies to every key of that name in every file. Put a collection-specific override under that collection's `_inputs`, not at the bottom of the file.
- **Singletons disable creation.** Homepage, pages, global sections, header & footer and settings set `disable_add`, `disable_add_folder` and `disable_file_actions`, because adding a JSON file there creates no route. Only slug-based collections (services, locations, posts, forms) allow "+ Add", through `add_options` → a schema file in `sites/<domain>/.cloudcannon/schemas/`.
- **New collection entries start `draft: true`** in their schema file when the grids filter drafts; an editor publishes by flipping the switch.
- **Hand-built routes carry a `permalink` key** in their JSON so "View live" and the Visual Editor work (`url: '{permalink}'`); it is a disabled text input. Slug-based collections use `url` templates (`/service/[full_slug]/`). Renaming a file moves the page; editing `permalink` does not.
- **In `src/content.config.ts`, every field inside an optional block must itself be optional.** A section left blank arrives as `hero: {}`; one required inner field turns that into `InvalidContentEntryDataError` — which takes down the whole dev server, for every page, until it is fixed.
- **Visual editing is opt-in per usage** through an `editablePrefix` prop; `packages/shared-ui/src/utils/editable.ts` emits `data-editable`/`data-prop` only when the prefix is passed. The prefix cannot be baked into a component: the same component sits at a different key per page (`hero` in a service's markdown vs `home.json`). A `data-prop` path is relative to the root of the ONE file the page's collection entry maps to, so a section fed from `global/*.json` or a collection cannot be bound that way and needs `data-editable="source"` with `data-path`. The `@cloudcannon/editable-regions` Astro integration goes in `astro.config.mjs`.
- **Forms post NATIVELY to an Inbox, not with fetch.** `TreeQuoteForm.astro` takes an `inboxKey` prop: when set it renders the `inbox_key` + `_gotcha` hidden inputs, sets `data-native-submit`, and the script calls `form.submit()` after validation. CloudCannon's hosting intercepts the POST, stores it in the Inbox, forwards it to the Inbox's targets and answers a 303 to `/thank-you/` — so `action` is the success page, and every site needs that page. **This only works on CloudCannon hosting**; the same output anywhere else silently breaks every form. Turnstile is validated by CloudCannon with **your own** keys, so the widget's allowed hostnames must include the CloudCannon domain and the site's custom domain.
- **Photographs come from the R2 DAM, which writes a FULLY QUALIFIED URL** into the content file, never a relative path or the old `r2:` sentinel. `packages/shared-ui/src/media/media-url.ts` recognises a URL by its origin matching `PUBLIC_MEDIA_BASE_URL`, so the DAM Base URL in CloudCannon must equal `business.technical.mediaBaseUrl` in `site.json`. **Never set `dam_static`**: it would make CloudCannon write root-relative paths that are indistinguishable from files in `public/` and skip build-time optimisation.
- **Photo keys get `uploads: src/assets/photos`** (`image`, `src`, `heroImage`, `backgroundImage`, …) so a "Site files" upload lands next to the hand-placed photographs rather than in `public/`. Icon and logo keys (`icon`, `logo`, `favicon`, `*Src`) are `type: image` with no path, so they stay in `public/media/`.
- **Before deleting or moving any asset**, grep `src/content/` for its path. A dangling reference is a failed build (bucket objects are downloaded at build time), not a broken image.
- **`.cloudcannon/preinstall` must never set shell options.** CloudCannon `source`s it, so `set -u` leaks into their `run.sh` and kills the build after a successful compile with `SYNC_PATHS: unbound variable`. Fail explicitly instead. `.gitattributes` pins `.cloudcannon/*` to LF; keep the site's copy listed there.
- **The build runs from the site directory, so the commands start with `cd ../..`.** Without it `bun install` runs inside `sites/<domain>` and the `workspace:*` deps do not resolve. Output path is `dist` relative to the site.
- **The CloudCannon Site must be connected to `main`.** CloudCannon builds the branch it is connected to; a Site on another branch never sees a merged PR. When a Site is first connected CloudCannon may write a stub `cloudcannon.config.yml` — expect a conflict if a real one already exists at that path.
- **The CloudCannon CLI (`@cloudcannon/cli`, `cloudcannon …`) cannot delete a Site** — `sites` offers list/get/create/rebuild/files/builds and log printing only. Deleting or renaming a Site is done in the CloudCannon web app. Its API signs requests with the local clock; a clock a second ahead of the server fails with `signed_at: Must be a time in the past`.
- **Turborepo's strict env mode silently drops undeclared variables.** `SOME_FLAG=1 bun run turbo build …` never reaches Astro; only vars listed under `env` in `turbo.json` survive. Run `bunx astro build` inside the site when measuring with an env flag.
- **A module-scope cache caches NOTHING across an Astro build.** Astro re-instantiates a component's module per page render; hang build-wide caches off `globalThis` (this took a 583-page build from 112 s to 7.5 s).

## Local dev server

- Start: `bun run dev --filter=<domain> -- --port 4321`. Free the port first (kill stray `node` processes) — turbo stops its child, not always Astro's.
- **A content-schema error in any single entry kills the entire dev server.** Always read the terminal before believing the browser.
- There is no local CMS. Edit content files on disk; the dev server reloads them. The CMS view of a change is only checkable after it is on `main`.
- Windows: `UnknownFilesystemError … EPERM rename .astro/data-store.json.tmp` means a stuck or duplicated dev process. Kill all `node` processes and restart.
- Kill the server when finished.

## SEO
- try to keep Seo title at 60 if posible
- try to keep Seo description at 155 if posible

## Images

**Where a file lives depends on what it is.** Three stores, and picking the wrong one is the mistake to avoid:

| What | Where | Written by |
| --- | --- | --- |
| Photographs uploaded through the CMS | **R2 bucket**, content stores the full bucket URL | CloudCannon R2 DAM (Site Settings → Assets) |
| Photographs placed by hand | `sites/<domain>/src/assets/` | `bun run import-photo` |
| SVG icons, logo, favicon | `public/media/` (copied verbatim) | Committed by hand or via "Site files" in CloudCannon |

- **Photos never travel Figma → repo. Figma exports vectors only; photographs enter through the image pipeline.**
- **CMS photo uploads go to R2, not to git.** The DAM uploads from the editor's browser straight to the bucket and writes `https://<bucket-origin>/photos/<file>` into the entry, so saving a page is a one-line JSON diff. Nothing in the site writes to the bucket; there is no R2 credential in the repo. The legacy `r2:<key>` notation is still recognised and can be mixed with DAM URLs.
- **R2 images are still optimised at BUILD time, not at request time.** `TreePicture.astro` resolves the stored value to the bucket URL, and Astro downloads the original, measures it and encodes the same AVIF/WebP/JPEG ladder it produces for a local import. `dist/` ships local files; no Cloudflare Images, no `/cdn-cgi/image`, nothing billed per transform. This requires the bucket host in `image.remotePatterns` — each site's `astro.config.mjs` does that from its settings.
- **The bucket's public origin has exactly one home:** `business.technical.mediaBaseUrl` in the site's CMS settings, read by `astro.config.mjs` and inlined as `PUBLIC_MEDIA_BASE_URL`. It must equal the DAM Base URL in CloudCannon. Empty is a valid state (nothing uploaded yet); an env var of the same name overrides it for previews. Changing it takes effect on the next build, like `siteUrl`.
- **Repointing a site at a different bucket requires copying the objects first**, and DAM-written content holds full URLs, so the old origin must be replaced across `src/content/` too. `bun run copy-media-bucket --site <domain> --from <bucket> --to <bucket> --apply` copies only what the content references (`--repoint <url>` switches `mediaBaseUrl` once the copy verified).
- Both stores render through `TreePicture.astro`, which wraps Astro's `<Picture />`: AVIF + WebP `<source>`s over a JPEG fallback at quality 90. Legacy `/src/assets/...` values keep working indefinitely — the two can be mixed on one page, including across an art-directed desktop/mobile pair.
- Import a hand-placed photograph with `bun run import-photo <file> --out sites/<domain>/src/assets/photos [--max-width N]`. It re-encodes to JPEG q90 (PNG, or lossy WebP when large, if the alpha channel is load-bearing) and downscales it under budget.
- Move a site's existing photographs into its bucket with `bun run migrate-media --site <domain>` (dry run; add `--apply`, then `--delete-local`). It derives content-addressed keys and rewrites every content reference; files still named by component defaults are reported and kept.
- `public/media/` is for SVG icons and the logo only — it is copied verbatim and nothing in it is optimized. **These deliberately stay in git**: a 2 KB SVG gains nothing from a second origin, and one is used as a CSS `mask-image`.
- Widths per slot, set with the `variant` prop: `hero` full-bleed 640/1024/1440/1920w, `card` (service + project) 400/800w, `inline` photos 600/1200w, `fixed` (badges, step icons) 1x/2x. Always pass `width`/`height` so no layout shift is possible.
- The hero image is `loading="eager"` + `fetchpriority="high"`. Everything below the fold is `loading="lazy"` + `decoding="async"`.
- No image file in the repo or in `dist/` may exceed 1 MB — `bun run check:sizes` enforces this on every build and in CI. **Only images fail the build** (raster plus `.svg`/`.ico`). Non-image files over 1 MB are still reported, but as a warning that does not fail. In CI both lists also surface as GitHub annotations on the run summary — `::warning` for the non-images, `::error` for the images that failed — capped at GitHub's 10-per-step limit with a notice when more were found.
- **Oversized images repair themselves — `bun run optimize:images`.** This only guards what is IN the repo (hand-placed photos and "Site files" uploads); a DAM upload never reaches a commit. It re-encodes any over-budget raster in place using the same rules (quality/width ladder down from 1920/q90) and, when the right format differs from what was uploaded, renames the file *and* rewrites every reference to it inside the owning site. It runs automatically in three places: `bun run build`, the `.githooks/pre-commit` hook (wired up by `bun install`), and CI before the build — CI commits the result back to `main`, which CloudCannon then rebuilds, so a "Site files" upload gets fixed without anyone touching a terminal.
- If image is inside a content loop item then it must be wrapped inside a link to that content item

## Carousels
- Use Embla Carousel for carousels
- use padding for slide items space separation instead of a column-gap

## Forms
- Save all forms submissions data in cms: every form posts natively to the site's CloudCannon **Inbox**, which stores each submission and forwards it to the Inbox's targets (email etc.). The Inbox key lives in Site Settings → Technical and reaches the form through `src/lib/forms.ts` as the `inboxKey` prop. Every site needs a `/thank-you/` page — CloudCannon answers the post with a 303 to it.
- Spam is handled by Turnstile — Cloudflare's free, invisible CAPTCHA replacement. The site key lives in CMS Site Settings → Technical; the secret is configured on the CloudCannon Inbox. The widget's allowed hostnames must include the CloudCannon domain and the site's custom domain.
- for phone fields use intl-tel-input library. validate that is valid phone number and auto select country
- all other fields must be validated according to its type (email, number, etc).
- all forms and their fields must be editable from cms and also reusable through pages: forms are a content model (`src/content/forms/*.json`, **Forms** in the sidebar, `getForm()` in `src/lib/forms.ts`).
- In Form fields you should be able to edit label, placeholder and field type (`_structures.form_fields` offers one shape per field type).

## Commands

```bash
# Development
bun run dev --filter=<domain> -- --port 4321   # one site (only ever run one)

# Build
bun run build                                  # all sites (parallel via Turborepo)
bun run build --filter=<domain>                # single site

# Lint
bun run lint

# Images
bun run import-photo <file...> --out sites/<domain>/src/assets/photos --max-width 1920
bun run check:sizes                            # fail on repo/dist IMAGES > 1 MB; warn on other files
bun run optimize:images                        # re-encode over-budget images in place + fix references
bun run optimize:images -- --check             # report only, change nothing

# Media (R2)
bun run migrate-media --site <domain>                    # dry run: what would move to the bucket
bun run migrate-media --site <domain> --apply            # upload + rewrite content references
bun run migrate-media --site <domain> --apply --delete-local   # ...and drop the originals

bun run copy-media-bucket --site <domain> --from <bucket> --to <bucket>          # dry run
bun run copy-media-bucket --site <domain> --from <bucket> --to <bucket> --apply  # copy referenced objects

bun run prune-media --site <domain>                      # dry run: unreferenced bucket objects
bun run prune-media --site <domain> --apply              # delete them (keeps the last 7 days)
bun run prune-media --site <domain> --before <ISO> --apply   # exact cutoff instead of an age

# One-time bucket setup per site (R2 is storage only; CloudCannon hosts the site)
wrangler r2 bucket create <slug>-media                   # slug = domain with dots as hyphens
wrangler r2 bucket dev-url enable <slug>-media           # -> https://pub-<hash>.r2.dev
# Custom domain instead? It must be a domain Cloudflare already manages for you,
# and --zone-id is REQUIRED (find it on the zone's dashboard Overview page):
#   wrangler r2 bucket domain add <slug>-media --domain media.<domain> --zone-id <id>
# then set Site Settings -> Technical -> Media Bucket URL to that origin and link
# the bucket as a DAM in CloudCannon (Site Settings -> Assets) with the same Base URL

# Scaffold a new site (clones an existing CloudCannon site and renames every reference)
./scripts/new-site.sh <domain> [--template <site>]
bunx create-astro-fleet add <domain> [--template <site>]   # cross-platform equivalent
bun install                                    # run after scaffolding

# CloudCannon CLI (@cloudcannon/cli) — inspect and rebuild, never delete
cloudcannon sites list
cloudcannon sites get --site <domain>
cloudcannon sites rebuild --site <domain>
cloudcannon sites print-last-failed-build --site <domain>
cloudcannon validate                           # checks a cloudcannon.config.yml

# Deploy: nothing to run. CloudCannon builds and hosts every site from main;
# merging a PR (or an editor saving) is the deploy. Custom domains are attached
# under the Site's Hosting settings in CloudCannon.

# Self-hosted infra (legacy, unused while CloudCannon hosts)
./scripts/setup-infra.sh domain1.com,domain2.com
```

## Architecture

### Monorepo layout

```
packages/config/             — DesignTokens interface + 3 presets (CORPORATE, SAAS, WARM)
packages/shared-ui/          — shared components (Tree* family + generic) + 3 layouts (BaseLayout, IndustryLayout, ProductLayout)
packages/create-astro-fleet/ — the cross-platform scaffolder (clones a CloudCannon site)
sites/<domain>/              — one directory per site: astro.config, package.json, cloudcannon.config.yml, .cloudcannon/{preinstall,schemas}, src/
scripts/                     — new-site.sh (scaffolder), media + image tooling, setup-infra.sh (legacy)
infrastructure/              — Docker Compose + Traefik + Caddy templates (legacy)
```

### Design token system

Tokens are defined as TypeScript objects (`packages/config/src/tokens.ts`) conforming to the `DesignTokens` interface. They get converted to CSS custom properties two ways:

1. **`tokensToCSSVars()`** in `packages/config/src/css.ts` — called by BaseLayout, injected into `:root` at build time
2. **`global.css` `@theme` layer** — each site duplicates token values for Tailwind CSS 4 integration

CSS variables: `--color-primary`, `--color-secondary`, `--color-accent`, `--color-bg`, `--color-text`, `--color-cta`, `--font-heading`, `--font-body`, `--hero-layout`, `--cta-style`, `--spacing`

### Per-site configuration

A site's identity is content, so editors own it. `src/content/settings/site.json` holds the site URL, name, logo, favicon, business identity, contact details, SEO title patterns, theme, `mediaBaseUrl`, the Turnstile site key and the Inbox key; `src/content/settings/header-footer.json` holds the menus (with submenus), footer columns and social links. `src/lib/site-config.ts` only re-exports from those files so pages and `astro.config.mjs` read one value. `astro.config.mjs` derives `site` and `image.remotePatterns` from the settings at config-load time (restart the dev server after changing them).

### Page pattern

Pages import `BaseLayout` from `@astro-fleet/shared-ui`, load their content entry (`getEntry`/`getCollection` from `astro:content`, or the helpers in `src/lib/`), and pass it to the section components as typed props plus an `editablePrefix` for the Visual Editor — no global state. Each hand-built route has a JSON file under `src/content/pages/` (or `homepage/home.json`) carrying its sections, SEO and `permalink`.

## Component Conventions

All shared components in `packages/shared-ui/src/components/`:

- Export a typed `Props` interface — no `any` types
- Use CSS custom properties for all colors/fonts (preset-agnostic)
- Scoped `<style>` blocks — no global CSS side effects
- No hardcoded content — everything via props or named slots
- `loading="lazy"` on images, `aria-*` on interactive elements
- Import path: `@astro-fleet/shared-ui/src/components/<Name>.astro`

## Workflow

- **Branch protection:** `main` is protected. All changes go through feature branches and PRs.
- **Commit messages:** conventional commits — `feat:`, `fix:`, `docs:`, `chore:`
- **CI:** GitHub Actions runs `bun install --frozen-lockfile` + `bun run build` on every PR and push to `main` as a check; it deploys nothing. CloudCannon builds and hosts from `main`.
- **CloudCannon commits land on `main`.** Do not edit content files on disk on the same branch an editor is working in without pulling first.

## Key Files to Know

- `sites/<domain>/cloudcannon.config.yml` — the whole CMS: sidebar, collections, input types, "+ Add" structures
- `sites/<domain>/src/content.config.ts` — Astro collection schemas (zod); must agree with the YAML and the content
- `sites/<domain>/src/content/settings/site.json` — site identity, contact, SEO patterns, `mediaBaseUrl`, Inbox key
- `sites/<domain>/.cloudcannon/preinstall` — installs bun on CloudCannon's build image (no shell options!)
- `sites/<domain>/.cloudcannon/schemas/*.md` — what "+ Add" creates for each collection
- `packages/shared-ui/src/media/media-url.ts` — how a DAM URL or `r2:` key becomes a bucket object at build time
- `packages/shared-ui/src/utils/editable.ts` — the `editablePrefix` mechanism behind Visual Editor regions
- `packages/shared-ui/src/components/TreeQuoteForm.astro` — the form component; `inboxKey` makes it a native Inbox post
- `packages/config/src/tokens.ts` — DesignTokens interface + CORPORATE/SAAS/WARM presets
- `packages/shared-ui/src/layouts/BaseLayout.astro` — main page shell (composes SEOHead, Header, Footer)
- `.github/workflows/ci.yml` — CI pipeline (build check + image budget; no deploy)

## Detailed Documentation

For in-depth guidance beyond what's in this file, refer to:

- [docs/adding-a-cms.md](docs/adding-a-cms.md) — CloudCannon: connecting a hosted Site, anatomy of `cloudcannon.config.yml`, keeping content/YAML/zod in step, forms and Inboxes, verifying changes
- [docs/adding-a-site.md](docs/adding-a-site.md) — Clone an existing CloudCannon site, give it a bucket, connect CloudCannon
- [docs/getting-started.md](docs/getting-started.md) — Clone to first deploy
- [docs/media-storage.md](docs/media-storage.md) — R2 media storage: the DAM, why uploads leave git, how they are still optimised at build time, bucket setup, migrating existing photos
- [docs/components.md](docs/components.md) — Props interfaces, usage examples, CSS variables, and recipes for the shared components and layouts
- [docs/seo-recipes.md](docs/seo-recipes.md) — Optional SEO add-ons not baked in (per-page OG images, git-based lastmod, llms.txt, markdown alternates, IndexNow, FuzzyRedirect, view transitions)
- [docs/design-tokens.md](docs/design-tokens.md) — How presets work, creating custom palettes
- [docs/framework-integrations.md](docs/framework-integrations.md) — Adding React/Vue/Svelte, Islands Architecture, View Transitions, Content Collections, and other Astro 6 capabilities
- [docs/deployment.md](docs/deployment.md) — CloudCannon hosting is the standard; the Cloudflare/Vercel/Netlify/self-hosted recipes there are legacy
- [docs/ai-workflow.md](docs/ai-workflow.md) — Sample prompts and AI-driven development patterns
