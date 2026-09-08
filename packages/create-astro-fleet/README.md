# create-astro-fleet

Scaffold an [Astro Fleet](https://github.com/indivar/astro-fleet) monorepo, or add a new site to an existing one.

Every site in the fleet is edited by [CloudCannon](https://cloudcannon.com). A new site is a clone of an existing CloudCannon site in the fleet — any directory under `sites/` that carries a `cloudcannon.config.yml` — with every reference to the template renamed to the new domain (package name, `siteUrl`, CloudCannon `source`, Worker name, submission paths). With exactly one such site the template is inferred; with several, pass `--template`.

## Usage

Bootstrap a new fleet (interactive):

```bash
npm create astro-fleet
# or
bunx create-astro-fleet
```

Add a site to the current fleet:

```bash
bunx create-astro-fleet add acme.com
bunx create-astro-fleet add acme.com --template client-a.com
```

Non-interactive:

```bash
bunx create-astro-fleet ./my-fleet --domain acme.com
```

## Commands

| Command                      | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `init [dir]` *(default)*     | Download the fleet template; clone the first site if the template ships one |
| `add <domain>`               | Add a site to the fleet containing the CWD               |
| `help`                       | Show help                                                |

## Options

### `init`

- `--template <source>` — giget source, default `github:indivar/astro-fleet`
- `--site-template <site>` — site under `sites/` to clone for the first site
- `--domain <name>` — skip the first-site domain prompt
- `--no-install` — skip dependency install (reserved; not yet implemented)

A template repository with no site in it creates an empty fleet; the first site is then added by hand (`docs/adding-a-cms.md` in the fleet describes the layout) and every later one is cloned from it.

### `add`

- `--template <site>` — site under `sites/` to clone (inferred when only one exists)

## After scaffolding

The clone still reads the template's media bucket. Create its own, copy the referenced objects across, then connect a CloudCannon Site on `main` (Source Folder `sites/<domain>`, Mode: Hosted, install and build commands prefixed with `cd ../..`, output `dist`), link the bucket as a DAM and create the site's Inbox. `docs/adding-a-site.md` in the fleet walks through it.

## License

MIT
