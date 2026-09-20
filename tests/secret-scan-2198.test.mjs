/**
 * @hive-mind-test-suite default
 *
 * Issue #2198: a CI/CD false negative.
 *
 * `secretlint`, `@secretlint/core` and
 * `@secretlint/secretlint-rule-preset-recommend` have been devDependencies
 * since the log sanitizer landed — src/*.lib.mjs runs secretlint's *API* over
 * solve/hive logs before they are attached to a pull request. But nothing ever
 * ran secretlint as a *linter* over the repository itself, and there was no
 * `.secretlintrc.json`. A credential committed to any tracked file would have
 * sailed through every job in "Checks and release".
 *
 * The template this repository's pipeline is derived from does run it:
 *
 *   - name: Check for secrets
 *     run: npx --yes -p secretlint -p @secretlint/secretlint-rule-preset-recommend secretlint "**\/*"
 *
 * so this was a gap against the template, not a deliberate omission.
 *
 * The scan is fail-closed. `.secretlintignore` exempts only the files whose
 * entire purpose is holding a *fake* secret (the sanitizer's own fixtures and
 * archived case-study logs); this test pins that list so it cannot quietly
 * grow into a blanket exemption, and pins the wiring so the scan cannot be
 * dropped from the lint job again.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(join(repoRoot, file), 'utf8').replaceAll('\r\n', '\n');

// --- the tooling is configured -------------------------------------------

assert.ok(existsSync(join(repoRoot, '.secretlintrc.json')), '.secretlintrc.json exists');
assert.ok(existsSync(join(repoRoot, '.secretlintignore')), '.secretlintignore exists');

const rc = JSON.parse(read('.secretlintrc.json'));
assert.deepEqual(
  rc.rules.map(rule => rule.id),
  ['@secretlint/secretlint-rule-preset-recommend'],
  'the recommended preset is the active rule set'
);

const pkg = JSON.parse(read('package.json'));
assert.ok(pkg.scripts['check:secrets'], 'package.json exposes a check:secrets script');
assert.match(pkg.scripts['check:secrets'], /secretlint .*--secretlintignore \.secretlintignore/, 'check:secrets honours the ignore list');
// These live in `dependencies`, not `devDependencies`, because the log
// sanitizer calls secretlint's API at runtime in published builds. That is
// exactly why the linter going unused was easy to miss: the packages were
// always installed, so their presence proved nothing about CI coverage.
for (const dep of ['secretlint', '@secretlint/secretlint-rule-preset-recommend']) {
  assert.ok(pkg.dependencies[dep], `${dep} is a declared runtime dependency`);
}

// --- CI actually runs it --------------------------------------------------

const release = read('.github/workflows/release.yml');
assert.match(release, /npm run check:secrets/, 'the release workflow runs the secret scan');

// It has to sit in a job that runs on every code change, next to the other
// fast checks — a scan gated behind a rarely-taken branch is the same false
// negative in a different shape.
const lintJob = release.slice(release.indexOf('\n  lint:'), release.indexOf('\n  # === FILE LINE LIMIT CHECK ==='));
assert.match(lintJob, /npm run check:secrets/, 'the secret scan runs in the lint job');
assert.match(lintJob, /npm run lint/, 'sanity: the slice really is the lint job');

// --- the exemption list stays narrow --------------------------------------

const ignored = read('.secretlintignore')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

assert.deepEqual(ignored, ['tests/test-token-sanitization.mjs', 'tests/test-credential-sanitization-2111.mjs', 'tests/test-telegram-auth-command.mjs', 'tests/test-issue-2189-sentry-log-sanitization.mjs', 'experiments/test-secretlint-api.mjs', 'experiments/issue-2156-*.mjs', 'docs/case-studies/**'], 'only the deliberate-fixture paths are exempt from the secret scan');

for (const pattern of ignored) {
  assert.doesNotMatch(pattern, /^(?:\*|\*\*|src\/|scripts\/|\.github\/)/, `"${pattern}" is not a blanket or source-tree exemption`);
}

// --- and the scan passes --------------------------------------------------
// Run the real binary rather than trusting the config: this is the assertion
// that would have caught a committed credential, and it is what CI runs.

const scan = spawnSync('npm', ['run', '--silent', 'check:secrets'], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1' },
});
assert.equal(scan.status, 0, `secretlint reported findings:\n${scan.stdout}${scan.stderr}`);

console.log('secret-scan-2198.test.mjs: all assertions passed');
