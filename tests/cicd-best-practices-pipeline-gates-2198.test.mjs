/**
 * @hive-mind-test-suite default
 *
 * Issue #2198. Two whole classes of gate were missing from this repository
 * *and* from the guide that is supposed to describe how its pipeline is built:
 *
 *   - nothing linted the workflow files themselves, so fourteen shell bugs and
 *     an over-broad `permissions` sat in `release.yml` unnoticed;
 *   - nothing audited the dependency tree, because CodeQL analyses our source
 *     and `dependency-review-action` only inspects the dependencies a pull
 *     request *changes*.
 *
 * Both are now implemented (`.github/workflows/workflows.yml`, the `npm-audit`
 * job in `.github/workflows/security.yml`). This test pins the *documentation*
 * of them, in all four translations, so the next repository built from this
 * guide does not repeat the omission -- the same shape as
 * tests/cicd-best-practices-container-images-2152.test.mjs.
 *
 * The details asserted below are the ones that are easy to get subtly wrong and
 * expensive to discover:
 *
 *   - actionlint must run as the Docker image. A bare binary without shellcheck
 *     on PATH skips every `run:` block and exits 0, which looks identical to
 *     passing.
 *   - `npm audit` must use `--package-lock-only` and an explicit `--audit-level`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

// Tool names, flags and URLs are not translated, so they are the same anchors
// in every language file.
for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');

  assert.match(guide, /actionlint/, `${guidePath} names actionlint`);
  assert.match(guide, /zizmor/, `${guidePath} names zizmor`);
  assert.match(guide, /docker:\/\/rhysd\/actionlint:/, `${guidePath} shows actionlint run as the Docker image`);
  assert.match(guide, /shellcheck/i, `${guidePath} explains why the image matters`);
  assert.match(guide, /--min-confidence medium/, `${guidePath} shows zizmor's confidence floor`);
  assert.match(guide, /excessive-permissions/, `${guidePath} names the audit that found the over-broad permissions`);

  assert.match(guide, /npm audit --package-lock-only/, `${guidePath} audits the lockfile as committed`);
  assert.match(guide, /--audit-level=high/, `${guidePath} sets an explicit audit level`);
  assert.match(guide, /dependency-review-action/, `${guidePath} explains what dependency review does not cover`);
}

const englishGuide = readFileSync(guidePaths[0], 'utf8');

const section = (heading, next) => englishGuide.match(new RegExp(`### ${heading}([\\s\\S]*?)### ${next}`))?.[1];

const workflowLinting = section('14\\.', '15\\.');
assert.ok(workflowLinting, 'the English guide has a workflow-linting section, numbered 14');
assert.match(workflowLinting, /pipeline is code/i, 'it says why workflows need linting at all');
assert.match(workflowLinting, /Docker image, not a bare binary/i, 'it warns about the silent-skip trap');
assert.match(workflowLinting, /exits 0/, 'it says what the trap looks like: a green run that checked nothing');
assert.match(workflowLinting, /annotations/i, 'it covers annotations vs SARIF');
assert.match(workflowLinting, /confidence[\s\S]*not[\s\S]*severity/i, 'it distinguishes a confidence floor from a severity floor');
assert.match(workflowLinting, /Scope suppressions/i, 'it requires suppressions to be scoped and dated');

const dependencyAudit = englishGuide.match(/### 15\.([\s\S]*?)\n## /)?.[1];
assert.ok(dependencyAudit, 'the English guide has a dependency-audit section, numbered 15');
assert.match(dependencyAudit, /does not audit your dependencies/i, 'it says what code scanning does not do');
assert.match(dependencyAudit, /only inspects the dependencies a PR .changes./i, 'it says what dependency review does not do');
assert.match(dependencyAudit, /schedule/i, 'it requires the audit to run on a schedule, not only on push');
assert.match(dependencyAudit, /pinned for a year/i, 'it names the case that falls through the gap');

console.log('cicd-best-practices-pipeline-gates-2198.test.mjs: all assertions passed');
