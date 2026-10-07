/**
 * @hive-mind-test-suite default
 *
 * Issue #2625. Four jobs on `main` failed for reasons no commit could fix: the
 * dependency-freshness gate failed every push after an upstream release, the
 * fixture cleanup failed every day on a ruleset that forbids branch deletion,
 * the Formal AI checks dispatch was refused with HTTP 422 before it started,
 * and the log upload retried a gist refusal three times. Principle 17 records
 * the general lesson so the next pipeline built from this guide does not
 * repeat it.
 *
 * Status codes, error texts, commands and YAML keys are not translated, so
 * they are the same anchors in every language file — the same shape as
 * tests/cicd-best-practices-publish-preflight-2221.test.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');
  const section = guide.match(/### 17\.([\s\S]*?)\n## /)?.[1];

  assert.ok(section, `${guidePath} has a seventeenth principle before the next chapter`);
  assert.ok(guide.indexOf('### 16.') < guide.indexOf('### 17.'), `${guidePath} keeps the principles in order`);
  assert.match(section, /#2625/, `${guidePath} links the evidence`);
  assert.match(section, /default: patch/, `${guidePath} shows the dispatch-safe input`);
  assert.match(section, /HTTP 422: Required input '<name>' not provided/, `${guidePath} quotes the dispatch refusal`);
  assert.match(section, /Resource not accessible by integration/, `${guidePath} quotes the token refusal`);
  assert.match(section, /Repository rule violations found/, `${guidePath} quotes the ruleset refusal`);
  assert.match(section, /HTTP 429/, `${guidePath} names what should still be retried`);
  assert.match(section, /gh label create/, `${guidePath} says how to stop depending on a label that may not exist`);
  assert.match(section, /No files were found with the provided path/, `${guidePath} quotes the silent empty artifact`);
}

const english = readFileSync(guidePaths[0], 'utf8').match(/### 17\.([\s\S]*?)\n## /)[1];
assert.match(english, /false negative/i, 'it names the failure class');
assert.match(english, /Gate external state on pull requests; on push, warn/i, 'it says where an external-state gate belongs');
assert.match(english, /A policy refusal is a decision, not a transient error/i, 'it separates refusals from retryable errors');
assert.match(english, /needs a default/i, 'it covers API-dispatched inputs');
assert.match(english, /Create what you depend on, or tolerate its absence/i, 'it covers missing labels');
assert.match(english, /Write logs where the upload step looks/i, 'it covers the empty artifact');

// The principle is only worth documenting if this repository follows it; each
// bullet has a regression test that pins the fix.
for (const test of ['dependency-freshness-main-push-2625.test.mjs', 'cleanup-task-fixtures-ruleset-2625.test.mjs', 'log-upload-permanent-403-2625.test.mjs', 'dispatch-checks-inputs-2625.test.mjs', 'formal-ai-draft-label-2625.test.mjs', 'solve-log-dir-2625.test.mjs']) {
  assert.ok(existsSync(`tests/${test}`), `tests/${test} pins the fix the guide describes`);
}

console.log('cicd-best-practices-false-negatives-2625.test.mjs: all assertions passed');
