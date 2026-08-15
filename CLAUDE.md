# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Astro Fleet is a multi-site Astro monorepo for agencies and multi-brand companies. Each site lives in `sites/<domain>/` and is independently deployable. Shared components and config live in `packages/`.

**Stack:** Astro 6, Bun, Turborepo 2, Tailwind CSS 4, TypeScript (strict mode). Static-first — zero client-side JS by default. Fonts are self-hosted via the Astro 6 Fonts API (configured in each site's `astro.config.mjs`, no third-party Google Fonts requests). 

**CMS:** keystatic on every site which runs **Keystatic** (`keystatic.config.ts`, admin at `/keystatic`). Keystatic needs server routes, you can use `@astrojs/cloudflare` adapter; its pages are still all prerendered.

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
- Create a section in cms sidebar names "Global Sections" if it doesnt exist.
- All sections or ui elements used in other pages for new created pages or edited pages if they got any section that look the same they must be reused and added in "Global Sections".
- Header & Footer sections must be added in cms sidebar with title "Header & Footer"
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
- When a change spans many files (new content model, new route family, renamed field), finish every part: schema + content JSON + Astro collection + pages + CMS navigation. A half-wired feature is worse than none.

## Verify before reporting

Every change to a content model, CMS schema, route, or shared component gets verified before it is reported as done:

1. `bun run build --filter=<domain>` — catches schema errors, broken routes and missing assets. Confirm the expected pages exist in `dist/`.
2. Or run the dev server and `curl` the touched routes: expect `200` **and** grep the HTML for the text/markup that should have changed.
3. For CMS work, prove the round trip: edit the field in `/keystatic`, confirm the value lands in the content file on disk, confirm the rendered page changes, then revert the test value.

Verifying is not optional and does not need permission. Never ask the user to run the app to find out whether the change worked.

## Keystatic — read before touching keystatic.config.ts or content files

These are failure modes that have already cost hours. They are silent: the CMS looks fine and the Save button simply does nothing.

- **Schema and content file must match exactly, both ways.** Adding a field to a singleton means adding the key to its JSON in the same change; removing a field means removing the key. A leftover key opens the entry as `Field validation failed: Key on object value "x" is not allowed` and nothing renders.
- **The next two apply to `fields.image` only** — the repo-backed icon fields. Photographs use `r2Image`, whose keys come from the filename and a content hash, so no path is derived from the field's position and nothing is ever relocated on save. Sharing one photo between two entries is just sharing a string.
- **An image inside `fields.array` is stored at `<directory>/<field-path>/<index>/<key>.<ext>`** — e.g. `hero.badges[0].src` with `directory: src/assets/badges` lands at `src/assets/badges/hero/badges/0/src.png`. Keystatic rewrites the value to that shape on save **and deletes the file it replaced**.
- **Never point two entries at the same image file.** Saving one entry relocates the file and breaks the other: its required image resolves to empty and that entry can no longer be saved at all (`footer.badges.0.src: Image is required`). Give every entry its own copy of the photo/icon.
- **A custom field is a plain object, not a plugin.** `r2Image` (`packages/shared-ui/src/media/r2-image-field.tsx`) is a `BasicFormField` — `kind: 'form'` plus parse/serialize/validate and a React `Input`. `validate` signals invalid by THROWING; the Input paints its own error message once `forceValidation` flips. Style custom inputs with Keystatic's `--kui-*` custom properties, which are already on the page, rather than importing @keystar/ui.
- **Before deleting or moving any asset**, grep `src/content/` for its path. A dangling reference bricks the entry that holds it.
- **"Save does nothing" is almost always client-side validation.** Scroll the form for red `… is required` text, or read the browser console: `Error: Field validation failed: …`.
- **If the CMS shows stale data, or complains about files that clearly exist, its browser cache is stale.** Keystatic keeps a snapshot in IndexedDB (`keystatic`, `keystatic-blobs`). Fix: DevTools → Application → Clear site data for the dev origin, reload `/keystatic`. Editing content files directly on disk while the CMS is open is what causes this — prefer editing through the CMS, and clear the cache after any direct edit.
- **In `src/content.config.ts`, every field inside an optional block must itself be optional.** Keystatic always writes an object for a field group, so a section left blank arrives as `hero: {}`. One required inner field turns that into `InvalidContentEntryDataError` — which takes down the whole dev server, for every page, until it is fixed.

## Local dev server

- Start: `bun run dev --filter=<domain> -- --port 4321`. Free the port first (kill stray `node` processes) — turbo stops its child, not always Astro's.
- **A content-schema error in any single entry kills the entire dev server.** Keystatic's admin is served by that same server, so while it is down every CMS save silently fails and no page updates. Always read the terminal before believing the browser.
- Windows: `UnknownFilesystemError … EPERM rename .astro/data-store.json.tmp` means a stuck or duplicated dev process. Kill all `node` processes and restart.
- Kill the server when finished.

## SEO
- try to keep Seo title at 60 if posible
- try to keep Seo description at 155 if posible

## Images

**Where a file lives depends on what it is.** Three stores, and picking the wrong one is the mistake to avoid:

| What | Where | Written by |
| --- | --- | --- |
| Photographs uploaded through the CMS | **R2 bucket**, content stores `r2:<key>` | `r2Image` field → `POST /api/media` |
| Photographs placed by hand | `sites/<domain>/src/assets/` | `bun run import-photo` |
| SVG icons, logo, favicon | `public/media/` (copied verbatim) | Keystatic `fields.image` |

- **Photos never travel Figma → repo. Figma exports vectors only; photographs enter through the image pipeline.**
- **CMS photo uploads go to R2, not to git.** The `r2Image` field (`packages/shared-ui/src/media/`) posts the file to `/api/media` as soon as it is dropped and stores `r2:<key>` in the entry, so saving a page is a one-line JSON diff instead of a multi-megabyte binary commit. The browser downscales anything over 1920px to JPEG q90 first — the same budget `import-photo` applies.
- **R2 images are still optimised at BUILD time, not at request time.** `TreePicture.astro` turns `r2:<key>` into the bucket URL, and Astro downloads the original, measures it and encodes the same AVIF/WebP/JPEG ladder it produces for a local import. `dist/` ships local files; no Cloudflare Images, no `/cdn-cgi/image`, nothing billed per transform. This requires the bucket host in `image.remotePatterns` — each site's `astro.config.mjs` does that from its settings.
- **The bucket's public origin has exactly one home:** `business.technical.mediaBaseUrl` in the site's CMS settings, read by `astro.config.mjs` and inlined as `PUBLIC_MEDIA_BASE_URL`. Empty is a valid state (nothing uploaded yet); an env var of the same name overrides it for previews. Changing it takes effect on the next build, like `siteUrl`.
- Both stores render through `TreePicture.astro`, which wraps Astro's `<Picture />`: AVIF + WebP `<source>`s over a JPEG fallback at quality 90. Legacy `/src/assets/...` values keep working indefinitely — the two can be mixed on one page, including across an art-directed desktop/mobile pair.
- Import a hand-placed photograph with `bun run import-photo <file> --out sites/<domain>/src/assets/photos [--max-width N]`. It re-encodes to JPEG q90 (PNG, or lossy WebP when large, if the alpha channel is load-bearing) and downscales it under budget.
- Move a site's existing photographs into its bucket with `bun run migrate-media --site <domain>` (dry run; add `--apply`, then `--delete-local`). It derives the same content-addressed keys the uploader would and rewrites every content reference; files still named by component defaults are reported and kept.
- `public/media/` is for SVG icons and the logo only — it is copied verbatim and nothing in it is optimized. **These deliberately stay in git**: a 2 KB SVG gains nothing from a second origin, and one is used as a CSS `mask-image`.
- Widths per slot, set with the `variant` prop: `hero` full-bleed 640/1024/1440/1920w, `card` (service + project) 400/800w, `inline` photos 600/1200w, `fixed` (badges, step icons) 1x/2x. Always pass `width`/`height` so no layout shift is possible.
- The hero image is `loading="eager"` + `fetchpriority="high"`. Everything below the fold is `loading="lazy"` + `decoding="async"`.
- No image file in the repo or in `dist/` may exceed 1 MB — `bun run check:sizes` enforces this on every build and in CI. **Only images fail the build** (raster plus `.svg`/`.ico`). Non-image files over 1 MB are still reported, but as a warning that does not fail — a fat JS bundle is a real problem with a different fix, and blocking a build on it was never this guard's job. Expect two standing warnings: the Keystatic admin bundle (~2.7 MB, loaded only by CMS editors) and the Worker bundle (~1.1 MB, never sent to a browser). In CI both lists also surface as GitHub annotations on the run summary — `::warning` for the non-images, `::error` for the images that failed — capped at GitHub's 10-per-step limit with a notice when more were found.
- **Oversized images repair themselves — `bun run optimize:images`.** This now only guards what is still IN the repo; an R2 upload is downscaled in the browser before it is sent and never reaches a commit. It re-encodes any over-budget raster in place using the same rules (quality/width ladder down from 1920/q90). When the right format differs from what was uploaded (a photographic PNG becomes a JPEG) it renames the file *and* rewrites every reference to it inside the owning site, so no content entry is left dangling. It runs automatically in three places: `bun run build`, the `.githooks/pre-commit` hook (wired up by `bun install`), and CI before the build — CI commits the result back to `main` so a Keystatic upload from the deployed admin gets fixed without anyone touching a terminal.
- If image is inside a content loop item then it must be wrapped inside a link to that content item

## Carousels
- Use Embla Carousel for carousels
- use padding for slide items space separation instead of a column-gap

## Forms
- Save all forms submissions data in cms
- Spam is handled by Turnstile — Cloudflare's free, invisible CAPTCHA replacement. 
- for phone fields use intl-tel-input library. validate that is valid phone number and auto select country
- all other fields must be validated according to its type (email, number, etc).
- all forms and their fields must be editable from crm and also resuable through pages and if it's posible make forms a content model in cms
- In Form fields you should be able to edit label, placeholder and field type


## Commands

```bash
# Development
bun run dev                                    # all sites (port 4321)
bun run dev --filter=<domain>                  # single site
bun run dev --filter=<domain> -- --port 4322   # custom port

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

bun run prune-media --site <domain>                      # dry run: unreferenced bucket objects
bun run prune-media --site <domain> --apply              # delete them (keeps the last 7 days)
bun run prune-media --site <domain> --before <ISO> --apply   # exact cutoff instead of an age

# One-time bucket setup per site
wrangler r2 bucket create <domain>-media
wrangler r2 bucket dev-url enable <domain>-media      # -> https://pub-<hash>.r2.dev
# Custom domain instead? It must be a domain Cloudflare already manages for you,
# and --zone-id is REQUIRED (find it on the zone's dashboard Overview page):
#   wrangler r2 bucket domain add <domain>-media --domain media.<domain> --zone-id <id>
# then set Site Settings -> Technical -> Media Bucket URL to that origin

# Scaffold a new site
./scripts/new-site.sh <domain> [corporate|saas|warm]
bun install  # run after scaffolding

# Deploy (Cloudflare Pages) — static sites
wrangler pages deploy sites/<domain>/dist --project-name=<name> --branch=main

# Deploy (Cloudflare Workers) — sites carrying the adapter, i.e. test-2.com.
# The adapter emits dist/client (assets) + dist/server (worker) and generates
# the wrangler config, so deploy that instead of the Pages command above.
# The SESSION KV namespace in it is auto-provisioned on first deploy.
wrangler deploy --config sites/<domain>/dist/server/wrangler.json

# Self-hosted infra
./scripts/setup-infra.sh domain1.com,domain2.com
```

## Architecture

### Monorepo layout

```
packages/config/       — DesignTokens interface + 3 presets (CORPORATE, SAAS, WARM)
packages/shared-ui/    — 22 shared components + 3 layouts (BaseLayout, IndustryLayout, ProductLayout)
sites/<domain>/        — individual sites, each with its own astro.config, package.json, and pages
scripts/               — new-site.sh (scaffolder), setup-infra.sh (Docker/Traefik)
infrastructure/        — Docker Compose + Traefik + Caddy templates
```

### Design token system

Tokens are defined as TypeScript objects (`packages/config/src/tokens.ts`) conforming to the `DesignTokens` interface. They get converted to CSS custom properties two ways:

1. **`tokensToCSSVars()`** in `packages/config/src/css.ts` — called by BaseLayout, injected into `:root` at build time
2. **`global.css` `@theme` layer** — each site duplicates token values for Tailwind CSS 4 integration

CSS variables: `--color-primary`, `--color-secondary`, `--color-accent`, `--color-bg`, `--color-text`, `--color-cta`, `--font-heading`, `--font-body`, `--hero-layout`, `--cta-style`, `--spacing`

### Per-site configuration

Each site has a single `src/lib/site-config.ts` that defines: site name, tagline, logo, navigation menu (with dropdown support), footer columns, contact info, and social links. Reading this one file gives full context on a site's identity.

### Page pattern

Pages import `BaseLayout` from `@astro-fleet/shared-ui`, a preset from `@astro-fleet/config/tokens`, and site config from `../lib/site-config`. All content is passed via typed props — no global state.

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
- **CI:** GitHub Actions runs `bun install --frozen-lockfile` + `bun run build` on every PR.
- **Deploys:** after merging, deploy individual sites with `wrangler pages deploy sites/<domain>/dist --project-name=<name> --branch=main`

## Key Files to Know

- `packages/config/src/tokens.ts` — DesignTokens interface + CORPORATE/SAAS/WARM presets
- `packages/config/src/css.ts` — `tokensToCSSVars()` utility
- `packages/shared-ui/src/layouts/BaseLayout.astro` — main page shell (composes SEOHead, Header, Footer)
- `packages/shared-ui/src/components/` — all 22 shared components
- `sites/<domain>/src/lib/site-config.ts` — site identity config (single file controls entire site brand)
- `sites/<domain>/src/styles/global.css` — Tailwind imports + `@theme` layer with token values
- `sites/<domain>/astro.config.mjs` — per-site Astro config (update `site` URL for each domain)
- `.github/workflows/ci.yml` — CI pipeline
- `.github/pull_request_template.md` — PR template

## Detailed Documentation

For in-depth guidance beyond what's in this file, refer to:

- [docs/components.md](docs/components.md) — Props interfaces, usage examples, CSS variables, and recipes for all 22 components and 3 layouts
- [docs/getting-started.md](docs/getting-started.md) — Clone to first deploy in 15 minutes
- [docs/adding-a-site.md](docs/adding-a-site.md) — Scaffold, configure, and deploy a new site
- [docs/adding-a-cms.md](docs/adding-a-cms.md) — Keystatic pattern used in Meridian, access-control caveats, and alternatives
- [docs/media-storage.md](docs/media-storage.md) — R2 media storage: why uploads leave git, how they are still optimised at build time, bucket setup, the /api/media endpoint, and migrating existing photos
- [docs/seo-recipes.md](docs/seo-recipes.md) — Optional SEO add-ons not baked into the starter (per-page OG images, git-based lastmod, llms.txt, markdown alternates, IndexNow, FuzzyRedirect, view transitions)
- [docs/design-tokens.md](docs/design-tokens.md) — How presets work, creating custom palettes
- [docs/framework-integrations.md](docs/framework-integrations.md) — Adding React/Vue/Svelte, Islands Architecture, View Transitions, Content Collections, and other Astro 6 capabilities
- [docs/deployment.md](docs/deployment.md) — Cloudflare Pages, Vercel, Netlify, or self-hosted
- [docs/ai-workflow.md](docs/ai-workflow.md) — Sample prompts and AI-driven development patterns
