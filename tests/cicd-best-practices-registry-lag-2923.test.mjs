/**
 * @hive-mind-test-suite default
 *
 * Issue #2923. npm exposed 2.35.1 874s after a successful publish, so a 330s
 * verification window reported a good release as failed and skipped the GitHub
 * release, Docker images and Helm chart; the release gate then never repaired
 * the version. The E2E matrix skipped without saying why, and the agent log
 * claimed a recovery right before reporting the same error. Principles 9 and 17
 * record the lessons in every language.
 *
 * Commands, error texts and file names are not translated, so they are the same
 * anchors in every language file — the same shape as
 * tests/cicd-best-practices-false-negatives-2625.test.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2923
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');
  const release = guide.match(/### 9\.([\s\S]*?)\n### 10\./)?.[1];
  const changedWorld = guide.match(/### 17\.([\s\S]*?)\n## /)?.[1];

  assert.ok(release && changedWorld, `${guidePath} has principles 9 and 17`);
  assert.match(release, /#2923/, `${guidePath} links the evidence`);
  assert.match(release, /874/, `${guidePath} quotes the observed lag`);
  assert.match(release, /experiments\/npm-publish-lag-2923\.mjs/, `${guidePath} says how to measure the lag`);
  assert.match(release, /E409 Cannot publish over previously staged version/, `${guidePath} quotes the staged conflict`);
  assert.match(release, /GitHub release/, `${guidePath} says the release gate checks the GitHub release too`);
  assert.match(changedWorld, /::notice::/, `${guidePath} says how to report a skip`);
  assert.match(changedWorld, /❌ Agent reported error/, `${guidePath} quotes the contradicting message`);
}

// Each lesson has a regression test that pins the fix in this repository.
for (const test of ['publish-verification-window-2923.test.mjs', 'release-self-heal-github-release-2923.test.mjs', 'e2e-matrix-schedule-2324.test.mjs', 'agent-recovery-message-2923.test.mjs']) {
  assert.ok(existsSync(`tests/${test}`), `tests/${test} pins the fix the guide describes`);
}

console.log('cicd-best-practices-registry-lag-2923.test.mjs: all assertions passed');
