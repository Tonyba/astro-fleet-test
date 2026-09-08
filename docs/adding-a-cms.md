# The CMS — CloudCannon

Every site in this fleet is edited **and hosted** by [CloudCannon](https://cloudcannon.com), a git-based CMS: editors work in CloudCannon's hosted UI, every save is a commit to this repository, and CloudCannon builds the site from that commit and serves it. There is no admin route in the site, no database, no CMS code in the build and nothing to deploy from a terminal. What the editors see is described entirely by one YAML file per site, `sites/<domain>/cloudcannon.config.yml`.

This guide covers how a site is connected, the file that configures the editors, the rules that keep the CMS and the build in step, forms, and how to verify a change when the CMS runs somewhere you cannot run locally.

## Connecting a Site

One CloudCannon Site per directory under `sites/`, all on the **`main` branch** of this repository. Under the Site (not the Organization):

| Setting | Value |
| --- | --- |
| Details → Source Folder | `sites/<domain>` |
| Details → CloudCannon Configuration Path | `sites/<domain>/cloudcannon.config.yml` |
| Details → Mode | Hosted |
| Build → Install command | `cd ../.. && bun install --frozen-lockfile` |
| Build → Build command | `cd ../.. && bun run turbo build --filter=<domain>` |
| Build → Output path | `dist` |
| Build → Node version | 22 |
| Assets | Link the site's R2 bucket as a DAM. Base URL **must equal** `business.technical.mediaBaseUrl` in `src/content/settings/site.json` |
| Hosting | Attach the custom domain here once the first build is green |

Three things about the build settings are not obvious:

- **`cd ../..` is mandatory.** This is a bun + Turborepo monorepo: `bun install` must run from the repository root for the `workspace:*` dependencies on `@astro-fleet/shared-ui` and `@astro-fleet/config` to resolve. The Source Folder is the site so that paths in the config stay short and several Sites can share the repo; the commands hop back up.
- **bun is not in CloudCannon's build image.** `sites/<domain>/.cloudcannon/preinstall` installs it before the Install command runs. That file **must never set shell options** — CloudCannon `source`s it, so `set -u` leaks into their `run.sh` and kills the build *after* a successful compile with `SYNC_PATHS: unbound variable`. `.gitattributes` pins the hook to LF so a Windows checkout cannot hand Linux a `\r` shebang.
- **Nothing CMS-related is compiled into the site.** The same `bun run build --filter=<domain>` you run locally is what CloudCannon runs; if it passes here it passes there, image budget included.

The CloudCannon CLI (`@cloudcannon/cli`) can create and inspect Sites and read build logs — `cloudcannon sites create`, `cloudcannon sites get --site <domain>`, `cloudcannon sites print-last-failed-build --site <domain>`, `cloudcannon validate` for the YAML — but it cannot delete one; that is done in the web app.

## Anatomy of `cloudcannon.config.yml`

Every path in the file is relative to the site directory. The parts that matter most:

- **`collection_groups`** are the sidebar. The fleet's convention is fixed headings: *Pages*, *Content*, *Global Sections*, *Header & Footer*, *Forms*, *Settings*.
- **`collections_config`** maps a directory (or a glob within one) to a sidebar entry. Singletons — the homepage, global sections, header & footer, settings — disable `add`, `add_folder` and file actions so an editor cannot create a file no route reads. Collections whose filename is the slug (`services`, `locations`, `posts`, `forms`) get an `add_options` entry pointing at a schema file under `.cloudcannon/schemas/`, and a `create.path` template that slugifies the title.
- **`url`** on a collection is what "View live" opens and what the Visual Editor previews. Hand-built routes carry a `permalink` key in their JSON (`url: '{permalink}'`); slug-based collections use a template such as `/service/[full_slug]/`.
- **`_inputs`** set the input type **by key name**, globally at the bottom of the file and per collection above it. CloudCannon infers a type from the name when nothing says otherwise, which is why every key called `number` is declared `type: text` (they hold `"(203) 367-8219"` and `"01"`, not numbers).
- **`_structures`** are the shapes behind "+ Add" on an array. An array that can be empty **must** name a structure, or CloudCannon cannot infer an entry and marks the input misconfigured.
- **Images:** photograph keys (`image`, `src`, `heroImage`, `backgroundImage`, …) are `type: image` with `uploads: src/assets/photos`, so a "Site files" upload lands beside the hand-placed photographs rather than in `public/`. The DAM is the intended path and writes a **fully qualified bucket URL**. `dam_static` is deliberately unset: setting it would make CloudCannon write root-relative paths that are indistinguishable from files in `public/` and would bypass build-time optimisation. Icons and the logo are `type: image` with no upload path, so they stay in `public/media/`.
- **`paths.static` / `paths.uploads`** name where "Site files" uploads go (`public` and `public/media`); **`paths.dam_uploads`** the prefix inside the bucket (`photos`).

## Keeping three files in step

A content change usually touches three places, and all three must agree:

| File | Role | Breaks when out of step |
| --- | --- | --- |
| `src/content/**` | The data | — |
| `cloudcannon.config.yml` | What editors can see and add | A key the config does not describe still renders as a generic input; an array with no structure has a dead "+ Add"; a key whose name implies the wrong type shows as misconfigured |
| `src/content.config.ts` | What the build accepts (Astro collections, zod) | A required field an entry lacks throws `InvalidContentEntryDataError` and takes the whole dev server down — **every field inside an optional block must itself be optional**, because a blank section arrives as `{}` |

Adding a new section to a page therefore means: the JSON key with real content, the `_inputs`/`_structures` entries that make it editable and addable, the zod schema if the file is in a collection, the component that renders it, and the `editablePrefix` that lets the Visual Editor bind it.

New services and towns come from the schema files and start with `draft: true`, because every grid filters drafts; an editor publishes by flipping the switch.

## Visual editing

CloudCannon's Visual Editor renders the hosted build and lets editors click into it. Regions are opt-in per usage: a page passes an `editablePrefix` to a section component, and `packages/shared-ui/src/utils/editable.ts` emits `data-editable`/`data-prop` attributes from it. The prefix cannot be baked into a component, because the same component sits at a different key per page (`hero` inside a service's markdown vs `home.json`). A `data-prop` path is relative to the ROOT of the ONE file the page's collection entry maps to — so a section fed from `global/*.json` or from the `services` collection cannot be bound that way and needs `data-editable="source"` with `data-path` instead. The `@cloudcannon/editable-regions` Astro integration is registered in `astro.config.mjs`.

## Media

Photographs never enter git. The DAM writes `https://<bucket-origin>/photos/<file>` into the content file; `packages/shared-ui/src/media/media-url.ts` recognises that origin (it must match `PUBLIC_MEDIA_BASE_URL`, derived from `mediaBaseUrl`), strips it back to an object key, and `TreePicture.astro` has Astro download the original at build time and encode the AVIF/WebP/JPEG ladder locally. Nothing is transformed at request time. See [media-storage.md](./media-storage.md).

## Forms

Forms are a content model: one JSON file per form under `src/content/forms/`, listed under *Forms* in the sidebar, each field editable (label, placeholder, type, required, options). A page picks a form by id through `getForm()` in `src/lib/forms.ts`.

Submissions go to a CloudCannon **Inbox**. `TreeQuoteForm.astro` takes an `inboxKey` prop (injected from `business.technical.cloudcannonInboxKey` in the site settings): when set it renders the `inbox_key` and `_gotcha` hidden inputs, sets `data-native-submit`, and after client-side validation calls `form.submit()` — a **native** post, not fetch. CloudCannon's hosting intercepts it, stores the submission in the Inbox, forwards it to the Inbox's targets (email, webhooks) and answers a 303 to `/thank-you/`, so every site needs that page. Turnstile is validated by CloudCannon with **your own** keys, configured on the Inbox; the widget's allowed hostnames must include the CloudCannon domain and the custom domain.

This only works on CloudCannon hosting. The same output served anywhere else silently breaks every form.

## Verifying a CMS change

CloudCannon runs on CloudCannon, so the round trip cannot be driven from a terminal. What can be verified locally, and must be:

1. **The build.** `bun run build --filter=<domain>` after any change to content, the YAML or `content.config.ts`. Confirm the pages you touched exist under `dist/`. This is exactly what CloudCannon will run.
2. **The content shape.** Edit the content file exactly the way CloudCannon would write it (JSON, or bare YAML frontmatter for markdown — CloudCannon does not quote values), rebuild, and grep the built HTML for the new text.
3. **The YAML.** `cloudcannon validate` checks syntax; it does not know your content. Read the file back after editing, keep the key names identical to the content file, and check the three-way table above. After merging, open the entry in CloudCannon and look for inputs flagged as misconfigured or arrays whose "+ Add" does nothing.
4. **CloudCannon's own build**, after the push: `cloudcannon sites print-last-failed-build --site <domain>` when the Site shows red.
