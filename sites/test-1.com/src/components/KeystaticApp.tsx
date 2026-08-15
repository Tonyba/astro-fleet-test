import { makePage } from '@keystatic/astro/ui';
import config from '../../keystatic.config';

/**
 * The Keystatic admin app, as a plain React island.
 *
 * The @keystatic/astro integration normally injects this page straight out of
 * node_modules. That entrypoint is a `.astro` file, and the Cloudflare dev
 * runner cannot resolve it — `astro dev` 500s on /keystatic. Owning the two
 * routes as project files sidesteps the resolution entirely, and lets the
 * config be imported directly instead of through the `virtual:keystatic-config`
 * alias.
 */
export default makePage(config);
