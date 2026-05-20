#!/usr/bin/env node

import assert from 'node:assert/strict';
import { buildBranchSubjectLinks, buildPushRejectionFailureActionSection, buildPushRejectionExplanation, classifyPushRejection, shouldTreatPushRejectionAsRemoteSynchronized } from '../src/solve.branch-divergence.lib.mjs';
import { buildPrePullRequestFailureActionSection } from '../src/solve.pre-pr-failure-notifier.lib.mjs';

const incidentOutput = `To https://github.com/ideav/crm.git
 ! [remote rejected]   issue-2746-7b9af1dbec7d -> issue-2746-7b9af1dbec7d (cannot lock ref 'refs/heads/issue-2746-7b9af1dbec7d': reference already exists)
error: failed to push some refs to 'https://github.com/ideav/crm.git'`;

const nonFastForwardOutput = `To https://github.com/example/repo.git
 ! [rejected]        feature -> feature (non-fast-forward)
error: failed to push some refs to 'https://github.com/example/repo.git'`;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('classifies the issue #1817 incident as a remote-ref-already-exists rejection, not generic divergence', () => {
  assert.equal(classifyPushRejection(incidentOutput), 'remote-ref-already-exists');
});

test('classifies ordinary non-fast-forward output separately', () => {
  assert.equal(classifyPushRejection(nonFastForwardOutput), 'non-fast-forward');
});

test('treats rejected push as recoverable when origin branch equals local HEAD', () => {
  assert.equal(
    shouldTreatPushRejectionAsRemoteSynchronized({
      remoteExists: true,
      ahead: 0,
      behind: 0,
    }),
    true
  );
});

test('does not recover when the local and remote branch histories differ', () => {
  assert.equal(
    shouldTreatPushRejectionAsRemoteSynchronized({
      remoteExists: true,
      ahead: 1,
      behind: 2,
    }),
    false
  );
});

test('builds links for the exact repository, branch, base, head, and compare subject', () => {
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

test('push rejection explanation includes subject links and exact ahead/behind counts', () => {
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
    },
  });
  const text = lines.join('\n');

  assert.match(text, /Remote branch: ideav\/crm:issue-2746-7b9af1dbec7d/);
  assert.match(text, /Base branch: ideav\/crm:main/);
  assert.match(text, /Branch URL: https:\/\/github\.com\/ideav\/crm\/tree\/issue-2746-7b9af1dbec7d/);
  assert.match(text, /Compare URL: https:\/\/github\.com\/ideav\/crm\/compare\/main\.\.\.issue-2746-7b9af1dbec7d/);
  assert.match(text, /0 commit\(s\) ahead, 0 commit\(s\) behind origin\/issue-2746-7b9af1dbec7d/);
});

test('GitHub failure action section points reviewers at the exact branch and compare page', () => {
  const section = buildPushRejectionFailureActionSection({
    owner: 'ideav',
    repo: 'crm',
    branchName: 'issue-2746-7b9af1dbec7d',
    defaultBranch: 'main',
  });

  assert.match(section, /https:\/\/github\.com\/ideav\/crm\/tree\/issue-2746-7b9af1dbec7d/);
  assert.match(section, /https:\/\/github\.com\/ideav\/crm\/compare\/main\.\.\.issue-2746-7b9af1dbec7d/);
});

test('pre-PR failure comments keep push rejection remediation branch-specific', () => {
  const section = buildPrePullRequestFailureActionSection('Push rejected for ideav/crm:issue-2746-7b9af1dbec7d; compare https://github.com/ideav/crm/compare/main...issue-2746-7b9af1dbec7d and inspect https://github.com/ideav/crm/tree/issue-2746-7b9af1dbec7d');

  assert.match(section, /https:\/\/github\.com\/ideav\/crm\/tree\/issue-2746-7b9af1dbec7d/);
  assert.match(section, /https:\/\/github\.com\/ideav\/crm\/compare\/main\.\.\.issue-2746-7b9af1dbec7d/);
  assert.match(section, /Do not force-push unless/);
});
