# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Astro Fleet is a multi-site Astro monorepo for agencies and multi-brand companies. Each site lives in `sites/<domain>/` and is independently deployable. Shared components and config live in `packages/`.

**Stack:** Astro 6, Bun, Turborepo 2, Tailwind CSS 4, TypeScript (strict mode). Static-first — zero client-side JS by default. Fonts are self-hosted via the Astro 6 Fonts API (configured in each site's `astro.config.mjs`, no third-party Google Fonts requests). 

**CMS:** Sveltia CMS

## Main development rules
- use figma-design-to-code skill if necessary
- Use figma mcp and figma skills if necessary
- Use Brave as default browser
- if you need to check browser limit yourself to 1 dev instance and if you dont know what port to open in localhost tell me
- The implementation must be pixel-perfect (1:1) compared to the Figma design.
- Do not redesign, reinterpret, or improve anything. Reproduce exactly what is in Figma.
- Use semantic HTML5 structure (header, nav, section, main, footer, etc.).
- Use taildwind for css. Minimal vanilla JavaScript only.
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
- Use clean BEM methodology for class naming.
- All elements inside a section that are repeatable (ex: accordion items, tabs, carousel items, etc.) must be editable from CMS too
- Images must use proper <img> tags with descriptive alt attributes.
- Follow modern CSS best practices. Navbar Requirements:
* On desktop: standard horizontal navigation layout.
* On tablet and mobile (max-width: 1024px):
    * Replace navigation links with a hamburger button.
    * The hamburger must toggle the visibility of the navigation menu.
    * The menu must expand/collapse smoothly (CSS transition required).
    * Use minimal vanilla JavaScript for toggle functionality.
    * The menu must be accessible (aria-expanded, proper button element).
    * No external libraries.
- any reusable ui section or layout must be save in packages/shared-ui following same format used in files already there
- all media files must be saved in public/media
- Do not add features that are not present in the Figma design.
- If spacing or font size is unclear, calculate proportionally from the design instead of guessing.
- If something from the Figma link cannot be accessed, state what is missing before generating code.
- Output only the code. No explanations.
- any text, link, button link, image, website logo (and favicon) or video must be editable from cms
- all menus (header, footer) must be editable from cms
- all global colors and fonts must be editable from cms if posible 
- all media files must be saved in media files path
- skip build and lint
- when asked for corrections or edits remember that you must follow figma design if links provided, IT MUST BE RESPONSIVE and also FOCUS ONLY IN MENTIONED SECTIONS OR UI ELEMENTS IF MENTIONED

## Images
- **Photos never travel Figma → repo. Figma exports vectors only; photographs enter through the image pipeline.**
- Photographs live in `sites/<domain>/src/assets/` (never `public/`) and render through `TreePicture.astro`, which wraps Astro's `<Picture />`: AVIF + WebP `<source>`s over a JPEG fallback at quality 90.
- Import every photograph with `bun run import-photo <file> --out sites/<domain>/src/assets/photos [--max-width N]`. It re-encodes to JPEG q90 (PNG, or lossy WebP when large, if the alpha channel is load-bearing) and downscales it under budget.
- `public/media/` is for SVG icons and the logo only — it is copied verbatim and nothing in it is optimized.
- Widths per slot, set with the `variant` prop: `hero` full-bleed 640/1024/1440/1920w, `card` (service + project) 400/800w, `inline` photos 600/1200w, `fixed` (badges, step icons) 1x/2x. Always pass `width`/`height` so no layout shift is possible.
- The hero image is `loading="eager"` + `fetchpriority="high"`. Everything below the fold is `loading="lazy"` + `decoding="async"`.
- No image file in the repo or in `dist/` may exceed 1 MB — `bun run check:sizes` enforces this on every build and in CI.

## Carousels
- Use Embla Carousel for carousels

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
bun run check:sizes                            # fail if any repo/dist file > 1 MB

# Scaffold a new site
./scripts/new-site.sh <domain> [corporate|saas|warm]
bun install  # run after scaffolding

# Deploy (Cloudflare Pages)
wrangler pages deploy sites/<domain>/dist --project-name=<name> --branch=main

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
- [docs/seo-recipes.md](docs/seo-recipes.md) — Optional SEO add-ons not baked into the starter (per-page OG images, git-based lastmod, llms.txt, markdown alternates, IndexNow, FuzzyRedirect, view transitions)
- [docs/design-tokens.md](docs/design-tokens.md) — How presets work, creating custom palettes
- [docs/framework-integrations.md](docs/framework-integrations.md) — Adding React/Vue/Svelte, Islands Architecture, View Transitions, Content Collections, and other Astro 6 capabilities
- [docs/deployment.md](docs/deployment.md) — Cloudflare Pages, Vercel, Netlify, or self-hosted
- [docs/ai-workflow.md](docs/ai-workflow.md) — Sample prompts and AI-driven development patterns
