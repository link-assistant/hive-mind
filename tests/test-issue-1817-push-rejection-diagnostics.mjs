#!/usr/bin/env node

import assert from 'node:assert/strict';
import { buildBranchSubjectLinks, buildPushRejectionFailureActionSection, buildPushRejectionExplanation, classifyPushRejection, handleRejectedPushForAutoPr, shouldTreatPushRejectionAsRemoteSynchronized } from '../src/solve.branch-divergence.lib.mjs';
import { buildPrePullRequestFailureActionSection } from '../src/solve.pre-pr-failure-notifier.lib.mjs';

const incidentOutput = `To https://github.com/ideav/crm.git
 ! [remote rejected]   issue-2746-7b9af1dbec7d -> issue-2746-7b9af1dbec7d (cannot lock ref 'refs/heads/issue-2746-7b9af1dbec7d': reference already exists)
error: failed to push some refs to 'https://github.com/ideav/crm.git'`;

const nonFastForwardOutput = `To https://github.com/example/repo.git
 ! [rejected]        feature -> feature (non-fast-forward)
error: failed to push some refs to 'https://github.com/example/repo.git'`;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function createMockDollar(resolver) {
  const calls = [];
  const dollar =
    () =>
    async (strings, ...values) => {
      const command = strings.reduce((text, part, index) => text + part + (values[index] ?? ''), '');
      calls.push(command);
      return resolver(command);
    };
  dollar.calls = calls;
  return dollar;
}

function result({ code = 0, stdout = '', stderr = '' } = {}) {
  return {
    code,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
  };
}

await test('classifies the issue #1817 incident as a remote-ref-already-exists rejection, not generic divergence', () => {
  assert.equal(classifyPushRejection(incidentOutput), 'remote-ref-already-exists');
});

await test('classifies ordinary non-fast-forward output separately', () => {
  assert.equal(classifyPushRejection(nonFastForwardOutput), 'non-fast-forward');
});

await test('treats rejected push as recoverable when origin branch equals local HEAD', () => {
  assert.equal(
    shouldTreatPushRejectionAsRemoteSynchronized({
      remoteExists: true,
      ahead: 0,
      behind: 0,
      localSha: '198c75161c3b3cbd8cadf6834d60c3f444996220',
      remoteSha: '198c75161c3b3cbd8cadf6834d60c3f444996220',
    }),
    true
  );
});

await test('does not recover when the local and remote branch histories differ', () => {
  assert.equal(
    shouldTreatPushRejectionAsRemoteSynchronized({
      remoteExists: true,
      ahead: 1,
      behind: 2,
    }),
    false
  );
});

await test('does not recover when ahead and behind counts are zero but SHAs disagree', () => {
  assert.equal(
    shouldTreatPushRejectionAsRemoteSynchronized({
      remoteExists: true,
      ahead: 0,
      behind: 0,
      localSha: '198c75161c3b3cbd8cadf6834d60c3f444996220',
      remoteSha: '8b47be7c00f0ba4ace61ffba086f8a55a50cfae2',
    }),
    false
  );
});

await test('builds links for the exact repository, branch, base, head, and compare subject', () => {
  const links = buildBranchSubjectLinks({
    owner: 'ideav',
    repo: 'crm',
    branchName: 'issue-2746-7b9af1dbec7d',
    defaultBranch: 'main',
  });

  assert.equal(links.repository, 'ideav/crm');
  assert.equal(links.headRepository, 'ideav/crm');
  assert.equal(links.baseBranchRef, 'ideav/crm:main');
  assert.equal(links.headBranchRef, 'ideav/crm:issue-2746-7b9af1dbec7d');
  assert.equal(links.branchUrl, 'https://github.com/ideav/crm/tree/issue-2746-7b9af1dbec7d');
  assert.equal(links.compareUrl, 'https://github.com/ideav/crm/compare/main...issue-2746-7b9af1dbec7d');
});

await test('push rejection explanation includes subject links and exact branch state', () => {
  const lines = buildPushRejectionExplanation({
    branchName: 'issue-2746-7b9af1dbec7d',
    owner: 'ideav',
    repo: 'crm',
    defaultBranch: 'main',
    classification: 'remote-ref-already-exists',
    divergence: {
      remoteExists: true,
      ahead: 0,
      behind: 0,
      localSha: '198c75161c3b3cbd8cadf6834d60c3f444996220',
      remoteSha: '198c75161c3b3cbd8cadf6834d60c3f444996220',
    },
  });
  const text = lines.join('\n');

  assert.match(text, /Remote branch: ideav\/crm:issue-2746-7b9af1dbec7d/);
  assert.match(text, /Base branch: ideav\/crm:main/);
  assert.match(text, /Branch URL: https:\/\/github\.com\/ideav\/crm\/tree\/issue-2746-7b9af1dbec7d/);
  assert.match(text, /Compare URL: https:\/\/github\.com\/ideav\/crm\/compare\/main\.\.\.issue-2746-7b9af1dbec7d/);
  assert.match(text, /0 commit\(s\) ahead, 0 commit\(s\) behind origin\/issue-2746-7b9af1dbec7d/);
  assert.match(text, /Local HEAD: 198c75161c3b/);
  assert.match(text, /Remote HEAD: 198c75161c3b/);
});

await test('rejected push handler recovers when the remote branch already equals local HEAD', async () => {
  const logs = [];
  const $ = createMockDollar(command => {
    if (command.startsWith('git fetch origin refs/heads/issue-2746-7b9af1dbec7d:refs/remotes/origin/issue-2746-7b9af1dbec7d')) {
      return result();
    }
    if (command.startsWith('git rev-list --count origin/issue-2746-7b9af1dbec7d..HEAD')) {
      return result({ stdout: '0\n' });
    }
    if (command.startsWith('git rev-list --count HEAD..origin/issue-2746-7b9af1dbec7d')) {
      return result({ stdout: '0\n' });
    }
    if (command.startsWith('git rev-parse HEAD')) {
      return result({ stdout: '198c75161c3b3cbd8cadf6834d60c3f444996220\n' });
    }
    if (command.startsWith('git rev-parse origin/issue-2746-7b9af1dbec7d')) {
      return result({ stdout: '198c75161c3b3cbd8cadf6834d60c3f444996220\n' });
    }
    return result({ code: 1, stderr: `unexpected command: ${command}` });
  });

  const handled = await handleRejectedPushForAutoPr({
    errorOutput: incidentOutput,
    $,
    tempDir: '/tmp/repro',
    log: async message => logs.push(String(message)),
    formatAligned: (icon, label, message) => `${icon} ${label} ${message}`,
    branchName: 'issue-2746-7b9af1dbec7d',
    isContinueMode: false,
    prNumber: null,
    owner: 'ideav',
    repo: 'crm',
    defaultBranch: 'main',
  });

  assert.equal(handled.handled, true);
  assert.equal(handled.branchReadyForPrCreation, true);
  assert.equal(handled.recoveredFromPushRejection, true);
  const text = logs.join('\n');
  assert.match(text, /PUSH REPORTED FAILURE/);
  assert.match(text, /Remote branch already matches local HEAD/);
  assert.match(text, /Local HEAD: 198c75161c3b/);
  assert.match(text, /Remote HEAD: 198c75161c3b/);
  assert.match(text, /Continuing with PR creation because no local commit would be lost/);
});

await test('GitHub failure action section points reviewers at the exact branch and compare page', () => {
  const section = buildPushRejectionFailureActionSection({
    owner: 'ideav',
    repo: 'crm',
    branchName: 'issue-2746-7b9af1dbec7d',
    defaultBranch: 'main',
  });

  assert.match(section, /https:\/\/github\.com\/ideav\/crm\/tree\/issue-2746-7b9af1dbec7d/);
  assert.match(section, /https:\/\/github\.com\/ideav\/crm\/compare\/main\.\.\.issue-2746-7b9af1dbec7d/);
});

await test('pre-PR failure comments keep push rejection remediation branch-specific', () => {
  const section = buildPrePullRequestFailureActionSection('Push rejected for ideav/crm:issue-2746-7b9af1dbec7d; compare https://github.com/ideav/crm/compare/main...issue-2746-7b9af1dbec7d and inspect https://github.com/ideav/crm/tree/issue-2746-7b9af1dbec7d');

  assert.match(section, /https:\/\/github\.com\/ideav\/crm\/tree\/issue-2746-7b9af1dbec7d/);
  assert.match(section, /https:\/\/github\.com\/ideav\/crm\/compare\/main\.\.\.issue-2746-7b9af1dbec7d/);
  assert.match(section, /Manual force-push remains blocked/);
});
