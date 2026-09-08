import * as p from '@clack/prompts';
import pc from 'picocolors';
import { parseArgs, validateDomain } from './args.mjs';
import { findFleetRoot } from './fleet-root.mjs';
import { scaffoldSite, slugify } from './scaffold.mjs';

export async function add(argv) {
  const { positional, flags } = parseArgs(argv);

  const root = await findFleetRoot();
  if (!root) {
    console.error(pc.red('Error: could not find an Astro Fleet root (looked for package.json with name "astro-fleet").'));
    console.error('Run this command from inside a fleet, or run `create-astro-fleet init` to start a new one.');
    process.exit(1);
  }

  p.intro(pc.bgCyan(pc.black(' add site ')));
  p.log.info(`Fleet: ${pc.dim(root)}`);

  let domain = positional[0] || flags.domain;
  if (!domain) {
    domain = await p.text({
      message: 'Domain for the new site (e.g. acme.com)',
      validate: (v) => validateDomain(v) ?? undefined,
    });
    if (p.isCancel(domain)) throw new Error('User cancelled.');
  } else {
    const err = validateDomain(domain);
    if (err) {
      p.log.error(err);
      process.exit(1);
    }
  }

  // Optional: with exactly one CloudCannon site in the fleet it is inferred.
  const requested = typeof flags.template === 'string' ? flags.template : undefined;

  const spin = p.spinner();
  spin.start(`Cloning ${requested ? `sites/${requested}` : 'the CloudCannon site'} into sites/${domain}`);
  let template;
  try {
    ({ template } = await scaffoldSite({ rootDir: root, domain, template: requested }));
    spin.stop(`Created sites/${domain} from sites/${template}`);
  } catch (err) {
    spin.stop(pc.red('Failed'));
    throw err;
  }

  p.outro(nextSteps(domain, template));
}

export function nextSteps(domain, template) {
  const slug = slugify(domain);
  const templateSlug = slugify(template);
  return (
    `${pc.green('✓')} Site ready. Next:\n` +
    `  ${pc.cyan('bun install')}\n` +
    `  ${pc.cyan(`bun run build --filter=${domain}`)}\n` +
    `  Give it its own media bucket (the clone still reads ${templateSlug}-media):\n` +
    `  ${pc.cyan(`wrangler r2 bucket create ${slug}-media`)}\n` +
    `  ${pc.cyan(`bun run copy-media-bucket --site ${domain} --from ${templateSlug}-media --to ${slug}-media --apply`)}\n` +
    `  Then create the CloudCannon Site on main (Source Folder sites/${domain}, Mode: Hosted,\n` +
    `  install "cd ../.. && bun install --frozen-lockfile", build "cd ../.. && bun run turbo build --filter=${domain}",\n` +
    `  output "dist"), link the bucket as a DAM and create its Inbox — see docs/adding-a-site.md.`
  );
}
