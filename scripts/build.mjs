#!/usr/bin/env node
/**
 * build.mjs
 * ---------
 * `bun run build [turbo flags...]`
 *
 * The build is three steps — repair oversized images, build, then enforce the
 * size budget on what was built — and it used to be a `&&` chain inside
 * package.json. A shell appends forwarded arguments to the LAST command in such
 * a chain, so `bun run build --filter=test-2.com` handed `--filter` to the size
 * checker (which ignored it) while turbo happily built all 14 packages. The
 * documented way to build one site was quietly building everything.
 *
 * Running the steps from here puts the flags where they belong.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const turboArgs = process.argv.slice(2);

/** Run a step, or exit with its status — a failed step must stop the build. */
function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    shell: true, // Windows needs it to resolve `bun`/`node` shims
  });
  if (result.error) {
    console.error(`✗ could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Before the build: a CMS upload over the budget is re-encoded (and its
// references rewritten) so the build consumes the optimized source.
run('node', ['scripts/optimize-images.mjs']);

// `bun run turbo` resolves the local binary — the same form CI uses.
run('bun', ['run', 'turbo', 'build', ...turboArgs]);

// After the build: the budget covers dist/ too, which only exists now.
run('node', ['scripts/check-file-sizes.mjs']);
