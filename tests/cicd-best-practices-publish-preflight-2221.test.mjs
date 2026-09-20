/**
 * @hive-mind-test-suite default
 *
 * Issue #2221. The guide had fifteen principles and none of them said what a
 * run on the default branch is *for*. Principle 5 orders cheap checks before
 * expensive ones inside a test run; nothing said that a pipeline whose job is
 * to publish must prove it can publish before it spends anything.
 *
 * link-foundation/box paid for the omission: run 33972074755 built the whole
 * image matrix, published 2.5.0 and 2.6.0, reported success, and delivered no
 * images, because `docker/login-action` was `continue-on-error: true`, the
 * mirror steps were guarded on its outcome, and `skipped` is not `failure`.
 *
 * This test pins the *documentation* of the principle in all four
 * translations, so the next repository built from this guide does not repeat
 * the omission -- the same shape as
 * tests/cicd-best-practices-pipeline-gates-2198.test.mjs.
 *
 * The details asserted below are the ones that are easy to get subtly wrong
 * and expensive to discover:
 *
 *   - the probe must be a write. Both registries answer a push-scoped token
 *     request with HTTP 200 without verifying that anything can be pushed.
 *   - the check must survive a fork PR, where there are no secrets at all.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2221
 * @see https://github.com/link-foundation/box/issues/117
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

// Endpoints, flags, status codes and variable names are not translated, so
// they are the same anchors in every language file.
for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');

  assert.match(guide, /### 16\./, `${guidePath} has a sixteenth principle`);
  assert.match(guide, /POST \/v2\/<repo>\/blobs\/uploads\//, `${guidePath} shows the write probe`);
  assert.match(guide, /DELETE <Location>/, `${guidePath} cancels the upload session it opened`);
  assert.match(guide, /403/, `${guidePath} records what the push actually answers when the token endpoint said 200`);
  assert.match(guide, /continue-on-error: true/, `${guidePath} keeps the login step from hiding the other failures`);
  assert.match(guide, /ACTIONS_ID_TOKEN_REQUEST_URL/, `${guidePath} says how to detect a missing id-token permission`);
  assert.match(guide, /DOCKERHUB_OIDC_CONNECTIONID/, `${guidePath} names Docker Hub's trusted publishing`);
  assert.match(guide, /--provenance/, `${guidePath} names npm's`);
  assert.match(guide, /release-preflight:/, `${guidePath} shows the job`);
  assert.match(guide, /needs\.release-preflight\.result == 'success'/, `${guidePath} shows the gate, not just the job`);
  assert.match(guide, /HTTP 429/, `${guidePath} covers the answer that must not be read as a failure`);
}

const englishGuide = readFileSync(guidePaths[0], 'utf8');

const preflight = englishGuide.match(/### 16\.([\s\S]*?)\n## /)?.[1];
assert.ok(preflight, 'the English guide has a publish-preflight section, numbered 16');
assert.match(preflight, /pull request exists to test the code/i, 'it says why a PR and a push to main are different jobs');
assert.match(preflight, /forks have no secrets/i, 'it says why a pull request must not be blocked by this check');
assert.match(preflight, /Probe with a write, not with a login/i, 'it says the probe must attempt a write');
assert.match(preflight, /verifies nothing/i, 'it says what the cheap version of the check actually measures');
assert.match(preflight, /Report every failure, not the first/i, 'it requires one report naming every missing credential');
assert.match(preflight, /Check reachability, not just writability/i, 'it covers the package nobody can pull');
assert.match(preflight, /private on first push/i, 'it names the GHCR default that produced box’s empty release');
assert.match(preflight, /Prefer trusted publishing/i, 'it points at the credential that cannot expire');
assert.match(preflight, /anonymously/i, 'it requires the published result to be verified as a reader sees it');
assert.match(preflight, /must not delete a good release/i, 'it warns against gating the release on the mirror push');
assert.match(preflight, /Report `unknown`, never a guess/i, 'it forbids reporting an outage as a missing image');

// The principle is only worth documenting if this repository follows it.
const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
assert.match(workflow, /^ {2}release-preflight:$/m, 'release.yml has the preflight job the guide describes');
assert.match(workflow, /needs\.release-preflight\.result == 'success'/, 'the publishing jobs are gated on it');

console.log('cicd-best-practices-publish-preflight-2221.test.mjs: all assertions passed');
