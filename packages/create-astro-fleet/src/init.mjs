import * as p from '@clack/prompts';
import pc from 'picocolors';
import { downloadTemplate } from 'giget';
import { resolve, join, basename } from 'node:path';
import { access, readFile, writeFile, readdir } from 'node:fs/promises';
import { parseArgs, validateDomain } from './args.mjs';
import { scaffoldSite, findTemplateSites } from './scaffold.mjs';
import { nextSteps } from './add.mjs';

const DEFAULT_TEMPLATE = 'github:indivar/astro-fleet';

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isEmpty(dir) {
  try {
    const entries = await readdir(dir);
    return entries.length === 0;
  } catch {
    return true;
  }
}

export async function init(argv) {
  const { positional, flags } = parseArgs(argv);

  p.intro(pc.bgCyan(pc.black(' create-astro-fleet ')));

  let targetArg = positional[0];
  if (!targetArg) {
    const answer = await p.text({
      message: 'Directory for the new fleet',
      placeholder: './my-astro-fleet',
      defaultValue: './my-astro-fleet',
    });
    if (p.isCancel(answer)) throw new Error('User cancelled.');
    targetArg = answer;
  }
  const targetDir = resolve(process.cwd(), targetArg);

  if (await pathExists(targetDir)) {
    if (!(await isEmpty(targetDir))) {
      const overwrite = await p.confirm({
        message: `${pc.yellow(targetDir)} is not empty. Continue anyway?`,
        initialValue: false,
      });
      if (p.isCancel(overwrite) || !overwrite) throw new Error('User cancelled.');
    }
  }

  let domain = flags.domain;
  if (!domain) {
    const answer = await p.text({
      message: 'Domain for your first site',
      placeholder: 'acme.com',
      validate: (v) => validateDomain(v) ?? undefined,
    });
    if (p.isCancel(answer)) throw new Error('User cancelled.');
    domain = answer;
  } else {
    const err = validateDomain(domain);
    if (err) {
      p.log.error(err);
      process.exit(1);
    }
  }

  const template = flags.template || DEFAULT_TEMPLATE;
  const siteTemplate = typeof flags['site-template'] === 'string' ? flags['site-template'] : undefined;

  const spin = p.spinner();
  spin.start(`Downloading template from ${template}`);
  try {
    await downloadTemplate(template, {
      dir: targetDir,
      force: true,
      provider: template.startsWith('github:') ? undefined : 'github',
    });
    spin.stop(`Downloaded to ${pc.dim(targetDir)}`);
  } catch (err) {
    spin.stop(pc.red('Download failed'));
    throw err;
  }

  await renameRootPackage(targetDir, basename(targetDir));

  // The first site is a clone of a CloudCannon site shipped with the template.
  // A template repo with no site in it (this one, since 2026-09-08) has nothing
  // to clone, so the fleet is created empty and the first site is added by hand.
  const candidates = await findTemplateSites(targetDir);
  if (siteTemplate || candidates.length > 0) {
    const scaffoldSpin = p.spinner();
    scaffoldSpin.start(`Cloning ${siteTemplate ? `sites/${siteTemplate}` : 'the CloudCannon site'} into sites/${domain}`);
    let used;
    try {
      ({ template: used } = await scaffoldSite({ rootDir: targetDir, domain, template: siteTemplate }));
      scaffoldSpin.stop(`Created sites/${domain} from sites/${used}`);
    } catch (err) {
      scaffoldSpin.stop(pc.red('Scaffold failed'));
      throw err;
    }
    p.outro(`${pc.green('✓')} Fleet ready. ${pc.cyan(`cd ${targetArg}`)} then:\n` + nextSteps(domain, used));
  } else {
    p.log.warn(
      `The template ships no CloudCannon site to clone, so sites/${domain} was not created.\n` +
        '  Add the first site by hand — docs/adding-a-cms.md describes the layout — and clone\n' +
        '  every later site from it with `create-astro-fleet add <domain>`.'
    );
    p.outro(`${pc.green('✓')} Fleet ready. ${pc.cyan(`cd ${targetArg}`)} then ${pc.cyan('bun install')}.`);
  }
}

async function renameRootPackage(targetDir, newName) {
  const pkgPath = join(targetDir, 'package.json');
  if (!(await pathExists(pkgPath))) return;
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.name = sanitizePackageName(newName);
  delete pkg.repository;
  delete pkg.homepage;
  delete pkg.bugs;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function sanitizePackageName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 214) || 'astro-fleet';
}
