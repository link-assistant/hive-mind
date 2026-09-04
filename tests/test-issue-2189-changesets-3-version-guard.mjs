#!/usr/bin/env node

/**
 * Issue #2189, requirement R25: adopt what changed in the dependencies we bumped.
 *
 * `@changesets/cli` 3.0 changed one behaviour this repository depends on:
 *
 *   node_modules/@changesets/cli/dist/version.mjs
 *     if (changesets.length === 0 && (preState == null || preState.mode !== "exit")) {
 *       log.warn("No unreleased changesets found.");
 *       throw new ExitError(1);
 *     }
 *
 * In 2.x the same branch warned and returned, so the process exited 0. The
 * release job reaches `npm run changeset:version` only when
 * `check-release-needed.mjs` saw changeset files — but `versionAndCommit` may
 * rebase onto an advanced `origin/main` in between, and that rebase can remove
 * the very changesets the decision was made on (another run released them
 * first). Under 2.x that ended quietly; under 3.0 it fails the release job.
 *
 * The existing `countChangesets() === 0` guard runs *before* the rebase, so it
 * cannot see this. What is pinned here is the second check, after the rebase:
 * an empty changeset set takes the same self-healing path as an advanced
 * remote (`already_released`) instead of invoking a command that now exits 1.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { versionAndCommit } from '../scripts/version-and-commit.lib.mjs';

console.log('=== Issue #2189 — @changesets/cli 3.0 exits 1 with no changesets ===\n');

/**
 * Run versionAndCommit against a recording runner.
 *
 * `remoteHead` differing from `localHead` is what makes the rebase happen; the
 * changeset count is read again afterwards, exactly as on a runner.
 */
async function runVersioning({ changesetCounts, localHead = 'aaa', remoteHead = 'aaa' }) {
  const calls = [];
  const outputs = {};
  const counts = [...changesetCounts];

  const runner = async (command, args = []) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    if (key === 'git rev-parse HEAD') return { code: 0, stdout: `${localHead}\n`, stderr: '' };
    if (key.startsWith('git rev-parse origin/')) return { code: 0, stdout: `${remoteHead}\n`, stderr: '' };
    if (key === 'git status --porcelain') return { code: 0, stdout: ' M package.json\n', stderr: '' };
    if (key.startsWith('git show')) return { code: 0, stdout: JSON.stringify({ version: '3.0.0' }), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };

  const result = await versionAndCommit({
    mode: 'changeset',
    runner,
    output: (key, value) => {
      outputs[key] = value;
    },
    readVersion: () => '2.16.0',
    // One call per invocation: the pre-rebase guard, then the post-rebase one.
    countChangesets: () => (counts.length > 1 ? counts.shift() : counts[0]),
    logger: { log() {}, error() {} },
    sleeper: async () => {},
  });

  return { calls, outputs, result };
}

console.log('1. Changesets consumed by another run while this one rebased\n');

const consumed = await runVersioning({ localHead: 'aaa', remoteHead: 'bbb', changesetCounts: [1, 0] });

assert(!consumed.calls.some(call => call.includes('changeset:version')), '`changeset:version` is not invoked with an empty changeset set — under @changesets/cli 3.0 that call exits 1 and fails the whole release job');
assert(
  consumed.calls.some(call => call.startsWith('git rebase')),
  'the rebase that consumed the changesets still happened, so this is the real production sequence and not a short-circuit before it'
);
assert(consumed.result.versionCommitted === false, 'nothing is reported as committed when there was nothing to version');
assert(consumed.result.alreadyReleased === true, 'the run takes the same self-healing path as an advanced remote, so the publish step still gets its chance');
assert(consumed.outputs.new_version === '2.16.0', `the version on disk after the rebase is reported (got ${consumed.outputs.new_version})`);
assert(!consumed.calls.some(call => call.startsWith('git push')), 'nothing is pushed when no bump was produced');

console.log('\n2. The normal path is untouched\n');

const normal = await runVersioning({ changesetCounts: [1, 1] });
assert(
  normal.calls.some(call => call.includes('changeset:version')),
  'a pending changeset is still versioned'
);
assert(normal.outputs.version_committed === 'true', 'a real bump is still committed and pushed');

const rebased = await runVersioning({ localHead: 'aaa', remoteHead: 'bbb', changesetCounts: [1, 1] });
assert(rebased.calls.some(call => call.startsWith('git rebase')) && rebased.calls.some(call => call.includes('changeset:version')), 'a rebase that keeps the changesets still versions them');

printSummary('Issue #2189 — @changesets/cli 3.0 version guard');
process.exit(getFailCount() > 0 ? 1 : 0);
