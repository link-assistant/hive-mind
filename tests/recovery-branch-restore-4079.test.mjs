/**
 * @hive-mind-test-suite default
 *
 * Issue #4079: a failed run preserved its uncommitted work on
 * `recovery/<branch>`, but the next `solve` of the same pull request started
 * from a fresh clone and never looked there, and the failure comment did not
 * name the branch. The next continue run now restores the work (or tells the
 * session where it is), and the failure comment names the branch.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { $ } from 'command-stream';

import { commitUncommittedChangesOnCriticalError } from '../src/critical-error-commit.lib.mjs';
import { restoreRecoveryBranchWork, withRestoredRecoveryBranchWork } from '../src/recovery-branch-restore.lib.mjs';

const quiet$ = options => $({ ...options, mirror: false });
const silentLog = async () => {};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const roots = [];
after(async () => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))));

const BRANCH = 'issue-4079-test';
const configure = dir => {
  git(dir, 'config', 'user.name', 'Hive Mind Test');
  git(dir, 'config', 'user.email', 'hive-mind-test@example.invalid');
};

/** A PR branch pushed to a bare remote, and a failed run that preserved `work` on recovery/<branch>. */
const failedRun = async work => {
  const root = await mkdtemp(join(tmpdir(), 'hive-4079-'));
  roots.push(root);
  const remote = join(root, 'remote.git');
  const first = join(root, 'first');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  await mkdir(first);
  git(first, 'init', '-q', '-b', BRANCH);
  configure(first);
  await writeFile(join(first, 'README.md'), 'line 1\nline 2\n');
  git(first, 'add', '.');
  git(first, 'commit', '-qm', 'base');
  git(first, 'remote', 'add', 'origin', remote);
  git(first, 'push', '-q', 'origin', BRANCH);
  await work(first);
  const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: first, branchName: BRANCH, $: quiet$, log: silentLog, reason: 'max_output_tokens' });
  assert.equal(preserved.pushed, true);
  return { root, remote, preserved };
};

/** The next solve run: a fresh clone of the PR branch. */
const nextRun = async ({ root, remote }, name = 'next') => {
  const dir = join(root, name);
  execFileSync('git', ['clone', '-q', '-b', BRANCH, remote, dir]);
  configure(dir);
  return dir;
};

const editReadmeAndAddFile = async dir => {
  await writeFile(join(dir, 'README.md'), 'line 1\nline 2 improved\n');
  await writeFile(join(dir, 'src.js'), 'export const done = true;\n');
};

test('the preserved work is restored, uncommitted, when the PR branch has not moved', async () => {
  const run = await failedRun(editReadmeAndAddFile);
  const dir = await nextRun(run);
  const logs = [];
  const restored = await restoreRecoveryBranchWork({ tempDir: dir, branchName: BRANCH, $: quiet$, log: async message => logs.push(message) });
  assert.equal(restored.status, 'applied');
  assert.equal(restored.commit, run.preserved.commit);
  assert.deepEqual(restored.files.sort(), ['README.md', 'src.js']);
  assert.equal(await readFile(join(dir, 'README.md'), 'utf8'), 'line 1\nline 2 improved\n');
  assert.equal(await readFile(join(dir, 'src.js'), 'utf8'), 'export const done = true;\n');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), git(dir, 'rev-parse', `origin/${BRANCH}`), 'nothing is committed for the session');
  assert.match(restored.feedbackLines[0], /`recovery\/issue-4079-test` \(commit [0-9a-f]{8}, 2 files: .*\) and has been restored to the working tree as uncommitted changes/);
  assert.equal(git(run.remote, 'rev-parse', `refs/heads/recovery/${BRANCH}`), run.preserved.commit, 'the recovery branch is kept');
  assert.ok(logs.some(message => /Restored it to the working tree/.test(message)));
});

test('nothing is restored or reported once the PR branch contains the work', async () => {
  const run = await failedRun(editReadmeAndAddFile);
  const dir = await nextRun(run);
  await restoreRecoveryBranchWork({ tempDir: dir, branchName: BRANCH, $: quiet$, log: silentLog });
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'restored work');
  git(dir, 'push', '-q', 'origin', BRANCH);
  const later = await nextRun(run, 'later');
  const again = await restoreRecoveryBranchWork({ tempDir: later, branchName: BRANCH, $: quiet$, log: silentLog });
  assert.equal(again.status, 'already-applied');
  assert.deepEqual(again.feedbackLines, []);
  assert.equal(git(later, 'status', '--porcelain'), '');
});

test('when the PR branch has moved on, the session is told where the work is', async () => {
  const run = await failedRun(editReadmeAndAddFile);
  const other = await nextRun(run, 'other');
  await writeFile(join(other, 'README.md'), 'line 1\nline 2 rewritten elsewhere\n');
  git(other, 'commit', '-qam', 'conflicting change');
  git(other, 'push', '-q', 'origin', BRANCH);
  const dir = await nextRun(run);
  const restored = await restoreRecoveryBranchWork({ tempDir: dir, branchName: BRANCH, $: quiet$, log: silentLog });
  assert.equal(restored.status, 'not-applied');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'the working tree is untouched');
  assert.match(restored.feedbackLines[0], /is preserved on `recovery\/issue-4079-test`.*could not be restored automatically.*git diff HEAD origin\/recovery\/issue-4079-test/);
});

test('no recovery branch: nothing happens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-4079-'));
  roots.push(root);
  const remote = join(root, 'remote.git');
  const dir = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  await mkdir(dir);
  git(dir, 'init', '-q', '-b', BRANCH);
  configure(dir);
  await writeFile(join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'a');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', 'origin', BRANCH);
  assert.deepEqual(await restoreRecoveryBranchWork({ tempDir: dir, branchName: BRANCH, $: quiet$, log: silentLog }), { status: 'none', recoveryBranch: `recovery/${BRANCH}`, feedbackLines: [] });
  assert.equal((await restoreRecoveryBranchWork({ tempDir: dir, branchName: BRANCH, $: quiet$, log: silentLog, remote: 'missing' })).status, 'error');
  assert.equal((await restoreRecoveryBranchWork({ tempDir: null, branchName: BRANCH, $: quiet$, log: silentLog })).status, 'none');
  assert.ok(!existsSync(join(dir, '.git', 'refs', 'remotes', 'origin', 'recovery')));
});

test('solve.mjs restores on continue runs and names the recovery branch in the failure comment', () => {
  const source = readFileSync(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(isContinueMode\) feedbackLines = await \(await import\('\.\/recovery-branch-restore\.lib\.mjs'\)\)\.withRestoredRecoveryBranchWork\(feedbackLines, \{ tempDir, branchName, \$, log \}\);/);
  assert.ok(source.indexOf('withRestoredRecoveryBranchWork(') < source.indexOf('await checkUncommittedChanges('), 'restored before the uncommitted-changes check');
  assert.match(source, /failureCommentNote: preserved\.committed \? describePreservedWork\(preserved\) : null/);
  assert.match(source, /errorMessage: limitReached \? undefined : \[.*, preservedWork\?\.failureCommentNote\]\.filter\(Boolean\)/);
});

test('withRestoredRecoveryBranchWork appends to the existing feedback, and leaves it alone when there is nothing to say', async () => {
  const run = await failedRun(editReadmeAndAddFile);
  const dir = await nextRun(run);
  const lines = await withRestoredRecoveryBranchWork(['earlier feedback'], { tempDir: dir, branchName: BRANCH, $: quiet$, log: silentLog });
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'earlier feedback');
  assert.match(lines[1], /has been restored to the working tree/);
  assert.equal(await withRestoredRecoveryBranchWork(null, { tempDir: null, branchName: BRANCH, $: quiet$, log: silentLog }), null);
});
