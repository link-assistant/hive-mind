#!/usr/bin/env node

import assert from 'node:assert/strict';
import { extractLinkedPullRequestsForIssue } from '../src/github.batch.lib.mjs';

const silentLog = async () => {};

function issueDataWith(nodes) {
  return {
    timelineItems: {
      nodes,
    },
  };
}

function prSource(overrides = {}) {
  return {
    source: {
      number: 111,
      title: 'Add multi-language localization',
      body: 'Resolves #110',
      state: 'OPEN',
      isDraft: false,
      url: 'https://github.example.test/example/repo/pull/111',
      ...overrides,
    },
  };
}

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

await test('counts open draft PRs that close the issue', async () => {
  const linkedPRs = await extractLinkedPullRequestsForIssue(
    issueDataWith([
      prSource({
        isDraft: true,
      }),
    ]),
    110,
    silentLog
  );

  assert.equal(linkedPRs.length, 1);
  assert.deepEqual(linkedPRs[0], {
    number: 111,
    title: 'Add multi-language localization',
    state: 'OPEN',
    isDraft: true,
    url: 'https://github.example.test/example/repo/pull/111',
  });
});

await test('ignores draft PRs that only mention the issue', async () => {
  const linkedPRs = await extractLinkedPullRequestsForIssue(
    issueDataWith([
      prSource({
        body: 'Related to #110',
        isDraft: true,
      }),
    ]),
    110,
    silentLog
  );

  assert.equal(linkedPRs.length, 0);
});

await test('ignores closed PRs even when they have closing keywords', async () => {
  const linkedPRs = await extractLinkedPullRequestsForIssue(
    issueDataWith([
      prSource({
        state: 'CLOSED',
        isDraft: true,
      }),
    ]),
    110,
    silentLog
  );

  assert.equal(linkedPRs.length, 0);
});
