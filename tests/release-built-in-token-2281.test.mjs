/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2281.
 *
 * The release fallback must work with the repository's built-in GITHUB_TOKEN.
 * The parent release job publishes its completed validation on the version
 * commit through the Checks API, then creates and merges an auditable release
 * PR without weakening protection for ordinary changes.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { landViaPullRequest } from '../scripts/release-pull-request.lib.mjs';
import { assertReleaseMetadataOnly } from '../scripts/version-and-commit.lib.mjs';

assert.doesNotThrow(() => assertReleaseMetadataOnly(['package.json', 'package-lock.json', 'CHANGELOG.md', '.changeset/fair-owls-release.md']), 'generated release metadata preserves the source tree validated by the parent workflow');
assert.throws(() => assertReleaseMetadataOnly(['package.json', 'src/solve.mjs']), /unvalidated source changes: src\/solve\.mjs/, 'a release must fail closed rather than attest a commit containing unvalidated source changes');

const calls = [];
const runner = async (command, args = []) => {
  const call = [command, ...args].join(' ');
  calls.push(call);
  if (call === 'git rev-parse HEAD') return { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
  if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
  if (call.startsWith('gh pr create')) {
    return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/9999\n', stderr: '' };
  }
  return { code: 0, stdout: '', stderr: '' };
};

const result = await landViaPullRequest({
  runner,
  version: '2.32.0',
  runId: '35587213311',
  sleeper: async () => {},
  logger: { log() {}, error() {} },
  sanitizeForPublication: async text => text,
});

assert.equal(result.landed, true, 'the existing built-in token must be sufficient for release landing');
assert.ok(
  calls.some(call => call.startsWith('gh pr create')),
  'the release remains auditable through a pull request'
);
assert.ok(
  calls.some(call => call.includes('gh api --method POST repos/link-assistant/hive-mind/check-runs') && call.includes('name=Pipeline Status')),
  'the parent release must attest its passed validation on the version commit through the Checks API'
);
assert.ok(
  calls.some(call => call.startsWith('gh pr checks') && call.includes('--required')),
  'the release must observe the required check before merging'
);
assert.ok(
  calls.some(call => call.startsWith('gh pr merge')),
  'the PR merges only after the required check passes'
);
assert.ok(calls.findIndex(call => call.startsWith('gh api')) < calls.findIndex(call => call.startsWith('gh pr checks')), 'the attestation must exist before the required-check watch begins');
assert.ok(calls.findIndex(call => call.startsWith('gh pr checks')) < calls.findIndex(call => call.startsWith('gh pr merge')), 'the required-check watch must finish before merge');

const failedAttestationCalls = [];
await assert.rejects(
  landViaPullRequest({
    runner: async (command, args = []) => {
      const call = [command, ...args].join(' ');
      failedAttestationCalls.push(call);
      if (call === 'git rev-parse HEAD') return { code: 0, stdout: `${'b'.repeat(40)}\n`, stderr: '' };
      if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
      if (call.startsWith('gh pr create')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/10000\n', stderr: '' };
      if (call.startsWith('gh api')) return { code: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' };
      return { code: 0, stdout: '', stderr: '' };
    },
    version: '2.32.0',
    runId: 'failed-attestation',
    sleeper: async () => {},
    logger: { log() {}, error() {} },
    sanitizeForPublication: async text => text,
  }),
  /gh api/,
  'failure to create the attestation must abort the release'
);
assert.equal(
  failedAttestationCalls.some(call => call.startsWith('gh pr checks')),
  false,
  'a missing attestation must not reach required-check observation'
);
assert.equal(
  failedAttestationCalls.some(call => call.startsWith('gh pr merge')),
  false,
  'a missing attestation must never reach merge'
);

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const releaseJob = releaseWorkflow.slice(releaseWorkflow.indexOf('  release:\n'), releaseWorkflow.indexOf('  docker-publish:\n'));
const instantReleaseJob = releaseWorkflow.slice(releaseWorkflow.indexOf('  instant-release:\n'), releaseWorkflow.indexOf('  docker-publish-instant:\n'));
const validationJobs = ['detect-changes', 'version-check', 'changeset-check', 'test-compilation', 'lint', 'check-file-line-limits', 'test-suites', 'test-execution', 'memory-check-linux', 'validate-docs', 'docker-pr-check', 'helm-pr-check', 'release-preflight'];
for (const [name, job] of [
  ['release', releaseJob],
  ['instant-release', instantReleaseJob],
]) {
  for (const validationJob of validationJobs) {
    assert.match(job, new RegExp(`needs: \\[[^\\n\\]]*\\b${validationJob}\\b`), `${name} must wait for ${validationJob} before publishing a successful check`);
  }
  assert.match(job, /!contains\(needs\.\*\.result, 'failure'\)/, `${name} must not attest a failed validation graph`);
}
assert.ok((releaseWorkflow.match(/GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/g) || []).length >= 2, 'both release modes must use the built-in token');
assert.doesNotMatch(releaseWorkflow, /RELEASE_PULL_REQUEST_TOKEN/, 'release must not depend on an unprovisioned PAT or App secret');
assert.equal((releaseWorkflow.match(/checks: write/g) || []).length, 2, 'only the two release jobs need permission to publish the attestation');

console.log('release-built-in-token-2281.test.mjs: all assertions passed');
