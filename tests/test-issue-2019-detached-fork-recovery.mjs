#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #2019 follow-up: when a non-fork replacement repository actually shares
 * history with upstream, it is almost certainly a fork that GitHub detached
 * (commonly after a private/public visibility change). GitHub documents that
 * detachment as permanent, so the only path that keeps the repository is a
 * GitHub Support request. Hive Mind must surface that non-deletion recovery
 * option instead of only offering deletion.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GITHUB_FORK_SUPPORT_URL, buildDetachedForkRecoveryGuidance, buildForkReplacementBlockedReason } from '../src/solve.repository-recovery-message.lib.mjs';
import { buildPrePullRequestFailureActionSection } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { checkReplacementRepositoryBranchSafety } from '../src/solve.repository-safety.lib.mjs';

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

const renderCommand = (strings, values) => strings.reduce((acc, chunk, index) => acc + chunk + (index < values.length ? String(values[index]) : ''), '');

function makeFakeDollar(handler) {
  const $ =
    options =>
    async (strings, ...values) => {
      const command = renderCommand(strings, values).trim();
      const response = await handler(command, options);
      return {
        code: response?.code ?? 0,
        stdout: Buffer.from(response?.stdout ?? ''),
        stderr: Buffer.from(response?.stderr ?? ''),
      };
    };
  return $;
}

await test('detached-fork recovery guidance points at the GitHub Support fork workflow without deletion', () => {
  const guidance = buildDetachedForkRecoveryGuidance({
    existingRepository: 'konard/Payel-git-ol-Octra',
    expectedUpstream: 'Payel-git-ol/Octra',
  });

  assert.match(guidance, /WITHOUT deleting konard\/Payel-git-ol-Octra/);
  assert.match(guidance, /Payel-git-ol\/Octra/);
  assert.equal(GITHUB_FORK_SUPPORT_URL, 'https://support.github.com/request/fork');
  assert.match(guidance, /https:\/\/support\.github\.com\/request\/fork/);
  assert.match(guidance, /private\/public visibility change|visibility was switched to private/i);
  assert.match(guidance, /cannot open a cross-repository pull request/);
});

await test('blocked reason surfaces the non-deletion recovery option and the detached-fork cause', () => {
  const reason = buildForkReplacementBlockedReason({
    existingRepository: 'konard/Payel-git-ol-Octra',
    expectedUpstream: 'Payel-git-ol/Octra',
    relationshipDescription: 'konard/Payel-git-ol-Octra is not a GitHub fork of Payel-git-ol/Octra.',
    safetyCheckDescription: 'Local Git branch reachability found 3 replacement branch tip(s) with commits not reachable from upstream.',
    likelyDetachedFork: true,
  });

  // Original terse prefix and force flag must remain intact (issue #1976).
  assert.match(reason, /^Repository setup halted - existing fork replacement could lose commits\./);
  assert.match(reason, /--allow-force-non-fork-repository-deletion/);
  // New: the first option is recovery without deletion via GitHub Support.
  assert.match(reason, /1\. Recover the fork link WITHOUT deleting/);
  assert.match(reason, /https:\/\/support\.github\.com\/request\/fork/);
  // New: the detached-fork likely-cause line is present when detected.
  assert.match(reason, /Likely cause: .*shares history with .* detached from its network/);
});

await test('blocked reason omits the detached-fork cause line when history is not shared', () => {
  const reason = buildForkReplacementBlockedReason({
    existingRepository: 'konard/unrelated-repo',
    expectedUpstream: 'someone/upstream',
    relationshipDescription: 'konard/unrelated-repo is not a GitHub fork of someone/upstream.',
    safetyCheckDescription: 'GitHub compare returned 404 Not Found, so Hive Mind could not prove the repository has no unique commits.',
    likelyDetachedFork: false,
  });

  assert.doesNotMatch(reason, /Likely cause:/);
  // The recovery option is always offered, since the user may still know it was a fork.
  assert.match(reason, /Recover the fork link WITHOUT deleting/);
});

await test('pre-PR failure action section includes the GitHub Support re-attach path', () => {
  const reason = buildForkReplacementBlockedReason({
    existingRepository: 'konard/Payel-git-ol-Octra',
    expectedUpstream: 'Payel-git-ol/Octra',
    relationshipDescription: 'konard/Payel-git-ol-Octra is not a GitHub fork of Payel-git-ol/Octra.',
    safetyCheckDescription: 'Local Git branch reachability found 3 replacement branch tip(s).',
    likelyDetachedFork: true,
  });

  const section = buildPrePullRequestFailureActionSection(reason);
  assert.match(section, /Recover the fork without deleting/);
  assert.match(section, /https:\/\/support\.github\.com\/request\/fork/);
  assert.match(section, /--allow-force-non-fork-repository-deletion/);
});

await test('branch-safety check flags a likely detached fork when history is shared', async () => {
  const $ = makeFakeDollar(command => {
    if (command.startsWith('git init')) return { stdout: '' };
    if (command.includes('git fetch')) return { stdout: '' };
    if (command.startsWith('git for-each-ref')) {
      return {
        stdout: ['replacement/master 5d713671483ac3a26d24826f89c61cecdb6a0da3', 'replacement/issue-9-86efa1403a45 7f860d683f3025b3caa810d4c633b127f9f50fe8'].join('\n'),
      };
    }
    if (command.includes('git rev-list --count replacement/master')) return { stdout: '0\n' };
    if (command.includes('git rev-list --count replacement/issue-9-86efa1403a45')) return { stdout: '1\n' };
    if (command.includes('git log -1 --format=%s replacement/issue-9-86efa1403a45')) return { stdout: 'Revert "Initial commit"\n' };
    throw new Error(`Unexpected command: ${command}`);
  });

  const result = await checkReplacementRepositoryBranchSafety({
    $,
    owner: 'Payel-git-ol',
    repo: 'Octra',
    existingRepository: 'konard/Payel-git-ol-Octra',
  });

  assert.equal(result.safeToDelete, false);
  assert.equal(result.reachableBranchCount, 1);
  assert.equal(result.likelyDetachedFork, true);
});

await test('branch-safety check does not flag a detached fork when no branch is reachable', async () => {
  const $ = makeFakeDollar(command => {
    if (command.startsWith('git init')) return { stdout: '' };
    if (command.includes('git fetch')) return { stdout: '' };
    if (command.startsWith('git for-each-ref')) {
      return { stdout: 'replacement/master abcabcabcabcabcabcabcabcabcabcabcabcabca' };
    }
    if (command.includes('git rev-list --count replacement/master')) return { stdout: '4\n' };
    if (command.includes('git log -1 --format=%s replacement/master')) return { stdout: 'Unrelated work\n' };
    throw new Error(`Unexpected command: ${command}`);
  });

  const result = await checkReplacementRepositoryBranchSafety({
    $,
    owner: 'someone',
    repo: 'upstream',
    existingRepository: 'konard/unrelated-repo',
  });

  assert.equal(result.reachableBranchCount, 0);
  assert.equal(result.likelyDetachedFork, false);
});

await test('repository setup logs the detached-fork explanation and support recovery path', () => {
  const source = readFileSync(new URL('../src/solve.repository.lib.mjs', import.meta.url), 'utf8');

  assert.match(source, /Detached fork:/);
  assert.match(source, /support\.github\.com\/request\/fork/);
  assert.match(source, /likelyDetachedFork,/);
});
