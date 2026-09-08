import { cp, readdir, readFile, writeFile, access, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

/**
 * Every site in the fleet is edited by CloudCannon, so a new site is a clone
 * of an existing CloudCannon site, not a blank starter: the content model,
 * cloudcannon.config.yml, the media pipeline and the form endpoint all come
 * along, and only the names change. The template is any site under sites/
 * that carries a cloudcannon.config.yml.
 */
export async function findTemplateSites(rootDir) {
  const sitesDir = join(rootDir, 'sites');
  if (!(await pathExists(sitesDir))) return [];
  const found = [];
  for (const entry of await readdir(sitesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (await pathExists(join(sitesDir, entry.name, 'cloudcannon.config.yml'))) found.push(entry.name);
  }
  return found.sort();
}

async function resolveTemplate(rootDir, template) {
  if (template) return template;
  const candidates = await findTemplateSites(rootDir);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(
      'No site under sites/ carries a cloudcannon.config.yml, so there is nothing to clone. ' +
        'Add the first CloudCannon site by hand (see docs/adding-a-cms.md), then clone it.'
    );
  }
  throw new Error(`Several CloudCannon sites found (${candidates.join(', ')}). Pass --template <site>.`);
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '.astro', '.wrangler']);
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mjs', '.js', '.json', '.jsonc', '.yml', '.yaml', '.md', '.astro', '.css', '.txt',
]);

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Bucket and other dot-free identifiers: acme.com -> acme-com. */
export function slugify(domain) {
  return domain.toLowerCase().replace(/\./g, '-');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export async function scaffoldSite({ rootDir, domain, template: requested }) {
  const template = await resolveTemplate(rootDir, requested);
  const sitesDir = join(rootDir, 'sites');
  const templateDir = join(sitesDir, template);
  const targetDir = join(sitesDir, domain);

  if (!(await pathExists(templateDir))) {
    throw new Error(`Template site not found at sites/${template} in ${rootDir}.`);
  }
  if (!(await pathExists(join(templateDir, 'cloudcannon.config.yml')))) {
    throw new Error(`sites/${template} has no cloudcannon.config.yml — only CloudCannon sites can be cloned.`);
  }
  if (await pathExists(targetDir)) {
    throw new Error(`sites/${domain} already exists.`);
  }

  // Build output, caches, node_modules and local secrets stay behind.
  await cp(templateDir, targetDir, {
    recursive: true,
    filter: (src) => {
      const name = src.split(/[\\/]/).pop();
      if (SKIP_DIRS.has(name)) return false;
      if (name === '.env' || name.startsWith('.env.')) return false;
      return true;
    },
  });

  // Rename every reference to the template site: the package name, the
  // canonical siteUrl in the CMS settings, the CloudCannon `source`, the Worker
  // name, the paths /api/quote commits submissions to, and the bucket the
  // comments point at.
  const domainRe = new RegExp(escapeRegExp(template), 'g');
  const slugRe = new RegExp(escapeRegExp(slugify(template)), 'g');
  const slug = slugify(domain);

  for await (const file of walk(targetDir)) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue;
    if ((await stat(file)).size > 2 * 1024 * 1024) continue;
    const original = await readFile(file, 'utf8');
    const next = original.replace(domainRe, domain).replace(slugRe, slug);
    if (next !== original) await writeFile(file, next);
  }

  return { targetDir, template };
}
