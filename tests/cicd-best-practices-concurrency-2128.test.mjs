/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2128. The CI/CD guide used to recommend
 * cancelling workflow runs on main, which could interrupt an active release.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];
const cancelCommit = "cancel-in-progress: ${{ github.event_name == 'pull_request' && github.event.action == 'synchronize' }}";
const lintGroup = "group: check-${{ github.workflow }}-${{ github.ref }}-${{ github.event.action == 'synchronize' && github.event.action || github.run_id }}-lint";
const workflowGroup = "group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}-${{ github.event_name }}-${{ github.event.action || 'run' }}-${{ (github.event_name == 'pull_request' && github.event.action == 'synchronize' && 'latest') || (github.event_name == 'push' && github.sha) || github.run_id }}";

for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');

  assert.equal(/cancel-in-progress:\s*\$\{\{\s*github\.ref\s*==\s*['"]refs\/heads\/main['"]\s*\}\}/.test(guide), false, `${guidePath} must not recommend cancelling an active main-branch release`);
  assert.ok(guide.includes('types: [synchronize, ready_for_review]'), `${guidePath} must show both pull request tiers`);
  assert.ok(guide.includes(`${lintGroup}\n      ${cancelCommit}`), `${guidePath} must give ready checks a per-run job group`);
  assert.ok(guide.includes(`${workflowGroup}\n  ${cancelCommit}`), `${guidePath} must preserve each ready run and each main SHA`);
  assert.match(guide, /group: main-writer-\$\{\{ github\.repository \}\}-main\n {6}cancel-in-progress: false/);
  assert.match(guide, /`queue: max`/);
}

const guide = readFileSync(guidePaths[0], 'utf8');
const concurrencySection = guide.match(/### 10\. Concurrency Control(?<section>[\s\S]*?)### 11\./)?.groups?.section;

assert.ok(concurrencySection, 'the English guide has a concurrency-control section');
assert.doesNotMatch(concurrencySection, /^ +cancel-in-progress: true$/m);
assert.match(concurrencySection, /read-only jobs:[^\n]*commit-tier[^\n]*ready PRs[^\n]*`main`/i);
assert.match(concurrencySection, /cancelled prerequisite[\s\S]*write job[^\n]*not start/i);
assert.match(concurrencySection, /already started[\s\S]*queue/i);
assert.match(concurrencySection, /matrix[\s\S]*group/i);
assert.match(concurrencySection, /workflow-level cancellation[^\n]*cannot publish, deploy, or change repository state/i);
assert.match(concurrencySection, /`!cancelled\(\)`[\s\S]*`always\(\)`/);

console.log('cicd-best-practices-concurrency-2128.test.mjs: all assertions passed');
