# Media storage — R2

CMS photo uploads go to a Cloudflare R2 bucket instead of the git repository.
Everything else about the image pipeline is unchanged: the same `<Picture>`
ladder, the same widths, the same quality, encoded at build time by sharp.

## Why

CloudCannon is a git-based CMS, so an image uploaded to "Site files" is a
commit. An editor uploading a photo from their phone would commit 6 MB of binary
to `main`, and the repo would grow with every edit — which is what
`optimize-images.mjs`, `check-file-sizes.mjs` and the 1 MB budget were built to
contain.

With the bucket linked as a DAM (Site Settings → Assets), a page save is a
one-line JSON diff:

```diff
-  "backgroundImage": "/src/assets/photos/homepage/hero/backgroundImage.jpg",
+  "backgroundImage": "https://pub-<hash>.r2.dev/photos/homepage/hero-3f2a9c1b.jpg",
```

The older `r2:<key>` sentinel that the previous uploader wrote is still
recognised, so both notations can sit in one site.

## What is stored where

| What | Where | Why |
| --- | --- | --- |
| Photographs uploaded through the CMS | R2, content holds the full bucket URL (or legacy `r2:<key>`) | the bytes; they are what grew the repo |
| Photographs placed by hand | `src/assets/` via `bun run import-photo` | build inputs a developer commits deliberately |
| SVG icons, logo, favicon | `public/media/` | 2 KB vectors, same-origin, one is a CSS `mask-image` |

## How a rendered image still gets optimised

Nothing is resized at request time and no image-transformation service is
involved — that would be billed per transform and slower than a static file.

1. `TreePicture.astro` resolves the stored value to `${mediaBaseUrl}/${key}` — a DAM URL is recognised by its origin (`isMediaUrl` in `packages/shared-ui/src/media/media-url.ts`), a legacy `r2:<key>` by its prefix.
2. Astro is allowed to fetch that host (`image.remotePatterns` in the site's
   `astro.config.mjs`, derived from the same setting).
3. At build time it downloads the original once, measures it, and writes AVIF +
   WebP + a JPEG fallback at the widths the slot asks for into `dist/_astro/`.
4. The page ships `<source>`s pointing at those local files.

The ladder is clamped to the source width, so a 1200px original is never
encoded four times over for a hero's 640/1024/1440/1920 ladder.

Every page in the fleet is prerendered, so the ladder is always produced at
build time. CI treats a content diff that *introduces* a new bucket reference as
a code change and rebuilds, so a photo uploaded through the CMS is encoded on
the very next run.

## Setup for a site

```bash
wrangler r2 bucket create <domain>-media
wrangler r2 bucket dev-url enable <domain>-media    # -> https://pub-<hash>.r2.dev
```

A **custom domain** is the alternative, but it only works for a domain Cloudflare
already manages for you — the bucket is attached to a zone, and `--zone-id` is
required (dashboard → the zone → Overview → Zone ID in the right sidebar):

```bash
wrangler r2 bucket domain add <domain>-media --domain media.<domain> --zone-id <zone id>
```

With no zones in the account that command cannot succeed; use the r2.dev URL.

**Does r2.dev's rate limiting matter?** Barely, because of where these URLs are
read. The build downloads each original once and the site serves the encoded
copies from `dist/_astro`, so a visitor never touches the bucket. Only the build
and the CMS preview do.

1. CloudCannon → Site Settings → Assets — link the bucket as a **DAM**. Uploads
   go straight from the editor's browser to the bucket; nothing in the site or
   the Worker ever writes to it, so there is no `MEDIA` binding and no R2
   credential anywhere in the repo.
2. Site Settings → Technical → **Media Bucket URL** (`mediaBaseUrl` in
   `src/content/settings/site.json`) — the public origin, equal to the DAM's
   Base URL. This is the single source of truth; `astro.config.mjs` reads it
   and inlines it as `PUBLIC_MEDIA_BASE_URL`. It takes effect on the next build.

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

## Who writes to the bucket

Only CloudCannon's DAM, from the editor's browser, with CloudCannon's own
credentials configured under Site Settings → Assets. No site ships an upload
endpoint any more: the `/api/media` route that the earlier Keystatic sites
carried was removed with them, so there is no R2 credential in the repo and
nothing on a public domain accepts an upload. The scripts below talk to the
bucket through `wrangler`, with the developer's own login.

## Keys

The DAM writes objects under `paths.dam_uploads` from `cloudcannon.config.yml`
(`photos/`), named by the uploaded file. `migrate-media` and `copy-media-bucket`
write content-addressed keys instead, `<prefix>/<slug>-<8 hex of sha256>.<ext>`
(e.g. `photos/about/team-photo-3f2a9c1b.jpg`), so re-running them lands on the
same object rather than littering the bucket. Both shapes are ordinary keys to
the build; the prefix is organisational only and nothing resolves through it.

Objects are never deleted when a field is cleared or replaced. An entry pointing
at a URL that another entry also uses is a normal, safe thing here — sharing a
photo between two entries is just sharing a string.

## Cleaning up unreferenced objects

Because clearing an image leaves its object behind, orphans accumulate. Sweep
them with:

```bash
bun run prune-media --site <domain>                        # dry run
bun run prune-media --site <domain> --apply                # keeps the last 7 days
bun run prune-media --site <domain> --before <ISO> --apply # exact cutoff
```

Deleting at the moment a field is cleared is not an option, which is why this is
a sweep. At that moment the CMS cannot know whether another entry uses the same
object, whether the editor will actually save, or whether the edit is on a
branch that will be merged. A sweep sees every reference at once.

Three things keep it from deleting a live image, each covering a real way that
could happen:

- **It reads every branch tip**, not just the checkout — an image referenced
  only by an unmerged branch is not an orphan.
- **It fetches and refuses to `--apply` while the checkout is behind its
  upstream.** The CMS commits to the remote, so a stale clone cannot tell a new
  reference from a missing one.
- **It keeps recent uploads** (`--keep-days`, default 7). An object is uploaded
  seconds *before* the entry referencing it is saved, so a sweep in that window
  would delete an image out from under an editor mid-edit.

`--before` exists for cleaning a known batch — after a migration the leftovers
sit inside a few minutes, and "older than that instant" is precisely the right
set, where "older than N days" would either catch nothing or reach too far.

Listing a bucket is the one R2 operation wrangler cannot do, so this command
uses Cloudflare's REST API with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
— the same pair that deploys the site, not an R2-specific token. They are
account-wide, so a `.env` at the repo root is the tidy home; every site reads it.
