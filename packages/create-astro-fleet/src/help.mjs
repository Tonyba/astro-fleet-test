import pc from 'picocolors';

export function printHelp() {
  console.log(`
${pc.bold('create-astro-fleet')} — scaffold an Astro Fleet monorepo or add a site.

Every site is edited by CloudCannon. A new site is a clone of an existing
CloudCannon site in the fleet (any site under sites/ that carries a
cloudcannon.config.yml) with every reference to the template renamed to the
new domain. With exactly one such site the template is inferred.

${pc.bold('Usage:')}
  ${pc.cyan('npm create astro-fleet')}                         Bootstrap a new fleet (interactive)
  ${pc.cyan('npm create astro-fleet my-fleet')}                Bootstrap into ./my-fleet
  ${pc.cyan('bunx create-astro-fleet add acme.com')}           Add a site to the current fleet

${pc.bold('Commands:')}
  init [dir]                Bootstrap a new fleet (default command)
  add  <domain>             Add a new site to an existing fleet
  help                      Show this help

${pc.bold('Options (init):')}
  --template <source>       giget template source (default: github:indivar/astro-fleet)
  --site-template <site>    site under sites/ to clone for the first site
  --domain <name>           first site domain (skips prompt)
  --no-install              skip dependency install

${pc.bold('Options (add):')}
  --template <site>         site under sites/ to clone (inferred when only one exists)
`);
}
