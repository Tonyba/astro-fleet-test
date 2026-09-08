# Getting Started

Get Astro Fleet running locally in under five minutes.

## Prerequisites

- **[Bun](https://bun.sh)** — install with `curl -fsSL https://bun.sh/install | bash`
- **Git**
- **Node.js 22.12+** (required by Astro 6 — check with `node --version`)
- **[Wrangler](https://developers.cloudflare.com/workers/wrangler/)** logged in to the Cloudflare account that holds the R2 media buckets (`bunx wrangler login`) — R2 is storage only; the sites themselves are hosted by CloudCannon
- **[CloudCannon CLI](https://cloudcannon.com)** (`npm i -g @cloudcannon/cli`, then `cloudcannon login`) — optional, for inspecting Sites and build logs

## 1. Clone the repository

```bash
git clone https://github.com/indivar/astro-fleet.git
cd astro-fleet
```

## 2. Install dependencies

```bash
bun install
```

This installs dependencies for all workspaces: the root, `packages/config`, `packages/shared-ui`, `packages/create-astro-fleet`, and every site under `sites/`. It also points git's hooks path at `.githooks/`, so oversized images are re-encoded before they can be committed.

## 3. Start a dev server

```bash
bun run dev --filter=<domain> -- --port 4321
```

The site is now running at **http://localhost:4321**. Photographs are downloaded from the site's R2 bucket on first render, so the first page load takes a few seconds.

There is no local CMS admin: content is edited on [CloudCannon](https://cloudcannon.com), which commits to this repository. Locally you edit the content files under `sites/<domain>/src/content/` directly and the dev server picks the change up.

## 4. Create a site

```bash
./scripts/new-site.sh yourdomain.com [--template <site>]
# or
bunx create-astro-fleet add yourdomain.com [--template <site>]
```

The script clones an existing CloudCannon site under `sites/` into `sites/yourdomain.com/` and renames every reference to the template. With no site in the fleet there is nothing to clone — build the first one by hand following [adding-a-cms.md](./adding-a-cms.md). See [adding-a-site.md](./adding-a-site.md) for the full walk-through, including the media bucket, the CloudCannon Site settings and the Inbox.

## 5. Install and build the new site

```bash
bun install
bun run build --filter=yourdomain.com
```

Then start its dev server:

```bash
bun run dev --filter=yourdomain.com -- --port 4321
```

## 6. Edit the site's content

Everything an editor can change is a file under `sites/yourdomain.com/src/content/`:

| Path | What it holds |
|------|---------------|
| `settings/site.json` | Site URL, name, logo, favicon, business identity, contact details, SEO patterns, media bucket URL, Inbox key |
| `settings/header-footer.json` | Header menu (with submenus), footer columns, social links |
| `homepage/home.json`, `pages/*.json` | Per-page sections and SEO for the hand-built routes in `src/pages/` |
| `global/*.json` | Sections shared by several pages |
| `services/`, `locations/`, `posts/` | Collections; the filename is the slug |
| `forms/*.json` | Reusable form definitions |

The CMS view of these files is described by `sites/yourdomain.com/cloudcannon.config.yml`. When you add a field to a content file, add it there too, and to the matching schema in `src/content.config.ts` if the file belongs to a collection.

## 7. Build for production

```bash
bun run build --filter=yourdomain.com
```

The static output lands in `sites/yourdomain.com/dist/`. This is exactly what CloudCannon builds on its side.

To build all sites at once:

```bash
bun run build
```

## 8. Deploy

There is nothing to run. CloudCannon is connected to `main`, builds the Site on every push and hosts the result; merging a PR, or an editor saving in the CMS, **is** the deploy. GitHub Actions builds every PR as a check so a broken build never reaches CloudCannon.

See [deployment.md](./deployment.md) for the CloudCannon build settings; the Cloudflare, Vercel, Netlify and self-hosted recipes there are legacy.

---

**That's it.** The full cycle is: clone → install → create site → connect CloudCannon → edit content → merge → CloudCannon builds and hosts.
