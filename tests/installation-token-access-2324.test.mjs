/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { repositoryWriteAccess } from '../src/github-write-access.lib.mjs';

test('unknown roles stay unknown and explicit user roles retain their meaning', () => {
  for (const permissions of [null, {}, undefined]) assert.equal(repositoryWriteAccess(permissions, 'github_pat_fixture'), null);
  for (const role of ['push', 'maintain', 'admin']) assert.equal(repositoryWriteAccess({ [role]: true }, 'ghp_fixture'), true);
  assert.equal(repositoryWriteAccess({ push: false }, 'ghp_fixture'), false);
  assert.equal(repositoryWriteAccess({ push: false }, 'ghs_15368_stateless_fixture'), null);
});

test('installation tokens use direct repository access instead of a user fork', () => {
  const [installation, readOnly, writable] = JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', 'experiments/issue-2324/installation-token-access-probe.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(installation.fork, false, 'all-false user permissions do not describe installation token contents access');
  assert.equal(installation.canProceed, true, 'GitHub enforces the installation token write permission on the actual write');
  assert.equal(readOnly.fork, true, 'a read-only user still uses their fork');
  assert.equal(readOnly.canProceed, false, 'an explicitly read-only user is rejected in direct mode');
  assert.equal(writable.fork, false);
  assert.equal(writable.canProceed, true);
});
