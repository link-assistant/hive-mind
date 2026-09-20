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
 *   - the review command — `npm approve-scripts --allow-scripts-pending` in
 *     npm 11.17, renamed to `npm install-scripts ls` in 11.19 — answers "No
 *     packages with unreviewed install scripts": it cannot see the package.
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
 * What the warning is *called* is not part of any of that. npm 11.19 renamed
 * the log prefix `npm warn allow-scripts` to `npm warn install-scripts` and
 * left `linkPkg()` exactly as it was; this file matched the old label
 * verbatim, so the rename alone turned the `test-suites` job red on run
 * 33890315861 — under a failure message claiming npm had fixed the bug. A
 * check that reports a vendor's cosmetic rename as a defect in our code is the
 * same false positive this issue is about, so the matcher below keys on the
 * sentence that states the defect, and the two labels npm has shipped so far
 * are pinned as samples rather than as the detector.
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
/**
 * Whether npm reported the linked package's install scripts as unreviewed.
 *
 * Keyed on the sentence, not the label. `1 package has install scripts not yet
 * covered by allowScripts:` is byte-identical in npm 11.17 and 11.19; the
 * prefix in front of it is not, and neither is the command it suggests. The
 * second alternative keeps either shipped prefix as a fallback signal, so a
 * future re-wording of the sentence does not silently read as "npm fixed it".
 */
const warnsAboutUnreviewedScripts = output => /not yet covered by allowScripts|npm warn (?:allow|install)-scripts/.test(output);

// Verbatim first lines of what each npm actually printed for this fixture,
// captured by experiments/issue-2198/npm-allow-scripts-warning-rename.sh.
// These are here so that tightening the matcher back onto one release's label
// fails at once instead of on the runners' next npm bump.
const SHIPPED_WARNING_SAMPLES = {
  '11.17.0': 'npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:',
  '11.19.0': 'npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:',
};

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
  assert(warnsAboutUnreviewedScripts(bare.output), 'a bare `npm link` still warns about unreviewed install scripts — if this fails, either npm fixed linkPkg() ' + 'and the --ignore-scripts workaround in scripts/test-global-commands.sh can be dropped, or npm re-worded the warning again; ' + 'experiments/issue-2198/npm-allow-scripts-warning-rename.sh tells the two apart ' + `(npm ${npmVersion}, output: ${JSON.stringify(bare.output.trim().slice(0, 400))})`);

  const ignored = linkFixture(['--ignore-scripts']);
  assert(!warnsAboutUnreviewedScripts(ignored.output), `\`npm link --ignore-scripts\` emits no unreviewed-scripts warning (npm ${npmVersion}, output: ${JSON.stringify(ignored.output.trim().slice(0, 400))})`);
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
    assert(warnsAboutUnreviewedScripts(withPolicy.output), `${label} still does not cover the linked package (npm/cli#9951)`);
  }
  const withFlag = linkFixture(['--allow-scripts=@hive-mind-fixture/link-me']);
  assert(warnsAboutUnreviewedScripts(withFlag.output), '--allow-scripts=<name> still does not cover the linked package (npm/cli#9951)');
}

// The matcher has to recognise every label npm has shipped, whichever one is
// installed here — that is the whole point of keying on the sentence.
for (const [version, sample] of Object.entries(SHIPPED_WARNING_SAMPLES)) {
  assert(warnsAboutUnreviewedScripts(sample), `the unreviewed-scripts matcher recognises what npm ${version} prints`);
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
