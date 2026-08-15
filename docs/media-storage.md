# Media storage — R2

CMS photo uploads go to a Cloudflare R2 bucket instead of the git repository.
Everything else about the image pipeline is unchanged: the same `<Picture>`
ladder, the same widths, the same quality, encoded at build time by sharp.

## Why

Keystatic is a git-based CMS, so `fields.image` commits the file. An editor
uploading a photo from their phone therefore committed 6 MB of binary to `main`,
and the repo grew with every edit — which is what `optimize-images.mjs`,
`check-file-sizes.mjs` and the 1 MB budget were built to contain.

With the bucket in the path, a page save is a one-line JSON diff:

```diff
-  "backgroundImage": "/src/assets/photos/homepage/hero/backgroundImage.jpg",
+  "backgroundImage": "r2:photos/homepage/hero-3f2a9c1b.jpg",
```

## What is stored where

| What | Where | Why |
| --- | --- | --- |
| Photographs uploaded through the CMS | R2, content holds `r2:<key>` | the bytes; they are what grew the repo |
| Photographs placed by hand | `src/assets/` via `bun run import-photo` | build inputs a developer commits deliberately |
| SVG icons, logo, favicon | `public/media/` | 2 KB vectors, same-origin, one is a CSS `mask-image` |

## How a rendered image still gets optimised

Nothing is resized at request time and no image-transformation service is
involved — that would be billed per transform and slower than a static file.

1. `TreePicture.astro` turns `r2:<key>` into `${mediaBaseUrl}/${key}`.
2. Astro is allowed to fetch that host (`image.remotePatterns` in the site's
   `astro.config.mjs`, derived from the same setting).
3. At build time it downloads the original once, measures it, and writes AVIF +
   WebP + a JPEG fallback at the widths the slot asks for into `dist/_astro/`.
4. The page ships `<source>`s pointing at those local files.

The ladder is clamped to the source width, so a 1200px original is never
encoded four times over for a hero's 640/1024/1440/1920 ladder.

**On a runtime-content site** (`deploy.runtimeContent`, e.g. test-1.com) pages
render on demand, where there is no sharp. Those sites pre-encode the ladder in
a prerendered endpoint, `src/pages/image-manifest.json.ts`, which walks the
content tree for `r2:` values as well as the local assets. A key that only
appears after that build has no ladder and is served straight from the bucket —
so CI treats a content diff that *introduces* an `r2:` key as a code change and
rebuilds.

## Setup for a site

```bash
wrangler r2 bucket create <domain>-media
# public read: a custom domain (preferred) …
wrangler r2 bucket domain add <domain>-media --domain media.<domain>
# … or the bucket's r2.dev address from the dashboard, for a quick start
```

1. `sites/<domain>/wrangler.jsonc` — bind it as `MEDIA` (already there for
   test-1.com and test-2.com).
2. Site Settings → Technical → **Media Bucket URL** — the public origin. This is
   the single source of truth; `astro.config.mjs` reads it and inlines it as
   `PUBLIC_MEDIA_BASE_URL`. It takes effect on the next build.
3. Local development only: R2 API credentials in `sites/<domain>/.env`
   (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`).
   `astro dev` runs in Node with no bindings, so it writes to the same bucket
   over R2's S3 API. **Production needs none of these** — the worker uses the
   binding.

## Moving existing photographs into the bucket

```bash
bun run migrate-media --site <domain>                          # dry run, prints the plan
bun run migrate-media --site <domain> --apply
bun run migrate-media --site <domain> --apply --delete-local
```

It derives exactly the keys the uploader would (`<prefix>/<slug>-<hash>.<ext>`),
uploads, then rewrites every reference in `src/content/`. `--delete-local` keeps
any file still named by a component default and tells you which component to fix
first.

## The endpoint

`POST /api/media` (multipart `file`, `prefix`) → `{ value: "r2:<key>", url }`
`GET  /api/media?prefix=…` → list · `GET /api/media?url=<key>` → public URL
`DELETE /api/media?key=…`

Authorisation is the point of that route: an open upload endpoint on a public
domain is free hosting for whoever finds it. Every request must carry the
Keystatic session cookie (`keystatic-gh-access-token`), which is checked against
GitHub for **push access to the site's repo** and cached for five minutes.
`astro dev` skips the check — Keystatic runs in local mode there and the server
is not on the internet.

Uploads are limited to 25 MB, restricted to image content types, and an SVG
containing script is refused.

## Keys

`<prefix>/<slug>-<8 hex of sha256>.<ext>` — e.g.
`photos/about/team-photo-3f2a9c1b.jpg`.

Content-addressed, so re-uploading the same file lands on the same object rather
than littering the bucket, and two photos both named `IMG_1234.jpg` cannot
collide. The prefix is organisational only: nothing resolves through it, so
unlike Keystatic's `directory` it can be renamed without orphaning anything.

Objects are never deleted when a field is cleared or replaced. An entry pointing
at a key that another entry also uses is a normal, safe thing here — the failure
mode that made shared images dangerous under `fields.image` does not exist.
