#!/usr/bin/env node

/**
 * Issue #2198: the test-execution job printed four warnings per run —
 *
 *   npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
 *   npm warn allow-scripts   @link-assistant/hive-mind@2.16.0 (prepare: husky)
 *   npm warn allow-scripts
 *   npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
 *
 * — emitted by the bare `npm link` in scripts/test-global-commands.sh once the
 * runners moved to npm 11.17 (allowScripts, npm/rfcs#868).
 *
 * The warning cannot be reviewed away, which is why the call site needs
 * --ignore-scripts rather than a policy entry:
 *
 *   - `npm approve-scripts --allow-scripts-pending` answers "No packages with
 *     unreviewed install scripts" — it cannot see the package.
 *   - neither `allowScripts` in package.json (by bare name or by name@version)
 *     nor `--allow-scripts=<name>` suppresses it. `linkPkg()` in npm's
 *     lib/commands/link.js never calls `resolveAllowScripts()` at all, so no
 *     policy ever reaches Arborist; its sibling `linkInstall()` does. Reported
 *     upstream as npm/cli#9951.
 *   - `--ignore-scripts` is the only lever that works, and here it costs
 *     nothing: the script it skips is this package's own `prepare: husky`,
 *     which installs Git hooks that the job's install step has already
 *     installed and that no global bin command depends on.
 *
 * The first block reproduces all of that from scratch against whatever npm is
 * on PATH, so the day npm fixes `linkPkg()` these tests start failing and tell
 * us the workaround can be dropped. The last block pins the call site.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 * @see https://github.com/npm/cli/issues/9951
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, skip, printSummary, getFailCount } from './test-helpers.mjs';

console.log('=== Issue #2198 — `npm link` must not warn about unreviewed install scripts ===\n');

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? '';
const [npmMajor, npmMinor] = npmVersion.split('.').map(Number);

// allowScripts landed in npm 11.17; older npm cannot produce the warning at all.
const npmHasAllowScripts = Number.isInteger(npmMajor) && (npmMajor > 11 || (npmMajor === 11 && npmMinor >= 17));

/**
 * Links a throwaway package that has the same shape as this repository — a
 * `prepare` script and a bin — into a temporary global prefix, and reports
 * everything npm printed plus whether the script actually ran.
 *
 * The "did it run" signal has to be a file on disk, not a string npm printed:
 * the warning quotes the script body back at you, so any sentinel the script
 * echoes shows up in the warning whether or not it ever executed.
 */
const linkFixture = (extraArgs, allowScripts) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-mind-2198-link-'));
  try {
    const pkgDir = join(dir, 'pkg');
    const prefix = join(dir, 'global');
    const ranMarker = join(dir, 'prepare-ran');
    mkdirSync(pkgDir);
    mkdirSync(prefix);
    writeFileSync(
      join(pkgDir, 'package.json'),
      `${JSON.stringify(
        {
          name: '@hive-mind-fixture/link-me',
          version: '1.0.0',
          bin: { 'hive-mind-fixture': './bin.mjs' },
          ...(allowScripts ? { allowScripts } : {}),
          scripts: { prepare: `node -e "require('node:fs').writeFileSync('${ranMarker.replaceAll('\\', '/')}', 'ran')"` },
        },
        null,
        2
      )}\n`
    );
    writeFileSync(join(pkgDir, 'bin.mjs'), "#!/usr/bin/env node\nconsole.log('ok');\n", { mode: 0o755 });

    const result = spawnSync('npm', ['link', ...extraArgs], {
      cwd: pkgDir,
      encoding: 'utf8',
      env: { ...process.env, npm_config_prefix: prefix, npm_config_update_notifier: 'false' },
    });
    return {
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      prepareRan: existsSync(ranMarker),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

if (!npmHasAllowScripts) {
  skip(`npm ${npmVersion || '(unknown)'} predates the allowScripts policy (npm 11.17) — nothing to reproduce`);
} else {
  const bare = linkFixture([]);
  assert(bare.output.includes('allow-scripts'), 'a bare `npm link` still warns about unreviewed install scripts — if this fails, npm fixed linkPkg() ' + 'and the --ignore-scripts workaround in scripts/test-global-commands.sh can be dropped ' + `(npm ${npmVersion}, output: ${JSON.stringify(bare.output.trim().slice(0, 400))})`);

  const ignored = linkFixture(['--ignore-scripts']);
  assert(!ignored.output.includes('allow-scripts'), `\`npm link --ignore-scripts\` emits no allow-scripts warning (npm ${npmVersion}, output: ${JSON.stringify(ignored.output.trim().slice(0, 400))})`);
  assert(!ignored.prepareRan, "`npm link --ignore-scripts` does not run the linked package's prepare script");
  // What --ignore-scripts actually costs, stated rather than assumed: a bare
  // link does run `prepare`. For this repository that is `husky`, already run
  // by the install step of the same job.
  assert(bare.prepareRan, "a bare `npm link` does run the linked package's prepare script");

  // None of the documented ways to review an install script reach a linked
  // package, so none of them is an alternative to --ignore-scripts here.
  for (const [label, policy] of [
    ['package.json allowScripts, bare name', { '@hive-mind-fixture/link-me': true }],
    ['package.json allowScripts, name@version', { '@hive-mind-fixture/link-me@1.0.0': true }],
  ]) {
    const withPolicy = linkFixture([], policy);
    assert(withPolicy.output.includes('allow-scripts'), `${label} still does not cover the linked package (npm/cli#9951)`);
  }
  const withFlag = linkFixture(['--allow-scripts=@hive-mind-fixture/link-me']);
  assert(withFlag.output.includes('allow-scripts'), '--allow-scripts=<name> still does not cover the linked package (npm/cli#9951)');
}

const globalCommandsScript = readFileSync(join(repoRoot, 'scripts', 'test-global-commands.sh'), 'utf8');
const linkInvocations = globalCommandsScript.match(/^\s*npm link\b.*$/gm) ?? [];

assert(linkInvocations.length === 1, `scripts/test-global-commands.sh calls \`npm link\` exactly once (found ${linkInvocations.length})`);
assert(
  linkInvocations.every(line => line.includes('--ignore-scripts')),
  `every \`npm link\` in scripts/test-global-commands.sh passes --ignore-scripts (found: ${JSON.stringify(linkInvocations)})`
);

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
