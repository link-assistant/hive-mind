/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2128. The CI/CD guide used to recommend
 * cancelling workflow runs on main, which could interrupt an active release.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');

  assert.equal(/cancel-in-progress:\s*\$\{\{\s*github\.ref\s*==\s*['"]refs\/heads\/main['"]\s*\}\}/.test(guide), false, `${guidePath} must not recommend cancelling an active main-branch release`);
  assert.match(guide, /group: check-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}-lint/);
  assert.match(guide, /group: main-writer-\$\{\{ github\.repository \}\}-main/);
  assert.match(guide, /cancel-in-progress: false/);
  assert.match(guide, /`queue: max`/);
}

const guide = readFileSync(guidePaths[0], 'utf8');
const concurrencySection = guide.match(/### 10\. Concurrency Control(?<section>[\s\S]*?)### 11\./)?.groups?.section;

assert.ok(concurrencySection, 'the English guide has a concurrency-control section');
assert.match(concurrencySection, /group: check-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}-lint/);
assert.match(concurrencySection, /cancel-in-progress: true/);
assert.match(concurrencySection, /group: main-writer-\$\{\{ github\.repository \}\}-main/);
assert.match(concurrencySection, /cancel-in-progress: false/);
assert.match(concurrencySection, /read-only[\s\S]*pull requests[\s\S]*`main`/i);
assert.match(concurrencySection, /cancelled prerequisite[\s\S]*write job[^\n]*not start/i);
assert.match(concurrencySection, /already started[\s\S]*queue/i);
assert.match(concurrencySection, /matrix[\s\S]*group/i);
assert.match(concurrencySection, /workflow level[\s\S]*write jobs/i);
assert.match(concurrencySection, /`!cancelled\(\)`[\s\S]*`always\(\)`/);

console.log('cicd-best-practices-concurrency-2128.test.mjs: all assertions passed');
