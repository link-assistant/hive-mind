#!/usr/bin/env node

/**
 * Regression test for issue #2315: critical-error recovery pushed build output
 * into the PR branch.
 *
 * Kotlin PR konard/test-hello-world-019fb330-fa49-…/pull/2 received
 * `923ff306 🛟 Auto-commit before critical-error recovery (stopped after two
 * identical AI sessions)` adding kotlinc's `Main.jar`: the recovery helper ran
 * `git add -A` in the PR branch and pushed it.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2315
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { $ } from 'command-stream';

import { commitUncommittedChangesOnCriticalError, describePreservedWork, recoveryBranchFor } from '../src/critical-error-commit.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${description}`);
    console.log(`      ${error.stack || error.message}`);
    failed++;
  }
};

const silentLog = async () => {};
const quiet$ = options => $({ ...options, mirror: false });
const git = (cwd, command) => execSync(`git ${command}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The Kotlin PR branch: Main.kt committed and pushed, a bare remote as origin. */
const createKotlinBranch = async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-2315-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  await mkdir(work);
  execSync(`git init -q --bare ${remote}`);
  git(work, 'init -q');
  git(work, 'config user.name "Hive Mind Test"');
  git(work, 'config user.email hive-mind-test@example.invalid');
  await writeFile(join(work, 'Main.kt'), 'fun main() = println("Hello, world!")\n');
  git(work, 'add Main.kt');
  git(work, 'commit -qm "Main.kt"');
  git(work, 'branch -M issue-1-604f2202fd18');
  git(work, `remote add origin ${remote}`);
  git(work, 'push -qu origin issue-1-604f2202fd18');
  return { root, remote, work, head: git(work, 'rev-parse HEAD') };
};

/** A kotlinc jar and a Maven/sbt target/ directory, both untracked and not ignored. */
const writeBuildOutput = async work => {
  await writeFile(join(work, 'Main.jar'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00, 0x08, 0x00]));
  await mkdir(join(work, 'target', 'classes'), { recursive: true });
  await writeFile(join(work, 'target', 'classes', 'MainKt.class'), Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41]));
  await writeFile(join(work, 'target', 'build.log'), 'compiled 1 file\n');
};

console.log('Issue #2315: recovery never changes the PR branch\n');

await test('untracked Main.jar and target/ are never committed; the PR branch is unchanged', async () => {
  const { root, remote, work, head } = await createKotlinBranch();
  try {
    await writeBuildOutput(work);
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: 'issue-1-604f2202fd18', $: quiet$, log: silentLog, reason: 'stopped after two identical AI sessions' });
    assert.equal(preserved.committed, false, 'only build output was uncommitted: nothing to preserve');
    assert.deepEqual(preserved.skipped.sort(), ['Main.jar', 'target/build.log', 'target/classes/MainKt.class']);
    assert.equal(git(work, 'rev-parse HEAD'), head);
    assert.equal(git(remote, 'rev-parse issue-1-604f2202fd18'), head);
    assert.equal(git(remote, 'branch --list "recovery/*"'), '', 'no recovery branch for build output');
    assert.match(describePreservedWork(preserved), /build output \(Main\.jar/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('a modified tracked file is preserved outside the PR branch, next to skipped build output', async () => {
  const { root, remote, work, head } = await createKotlinBranch();
  try {
    await writeBuildOutput(work);
    await writeFile(join(work, 'Main.kt'), 'fun main() = println("Hello, Kotlin!")\n');
    await writeFile(join(work, 'NOTES.md'), 'work in progress\n');
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: 'issue-1-604f2202fd18', $: quiet$, log: silentLog, reason: 'auto-restart limit 5/5 reached' });

    assert.equal(preserved.committed, true);
    assert.equal(preserved.pushed, true);
    assert.equal(preserved.recoveryBranch, recoveryBranchFor('issue-1-604f2202fd18'));
    assert.equal(preserved.recoveryBranch, 'recovery/issue-1-604f2202fd18');
    assert.deepEqual(preserved.preserved.sort(), ['Main.kt', 'NOTES.md']);

    // The PR branch - local and remote - is exactly where it was.
    assert.equal(git(work, 'rev-parse HEAD'), head);
    assert.equal(git(remote, 'rev-parse issue-1-604f2202fd18'), head);
    assert.equal(git(remote, 'diff --name-only issue-1-604f2202fd18 issue-1-604f2202fd18'), '');

    // The recovery branch holds the modification and no build output.
    assert.equal(git(remote, `rev-parse ${preserved.recoveryBranch}`), preserved.commit);
    assert.equal(git(remote, `rev-parse ${preserved.recoveryBranch}^`), head, 'the recovery commit sits on top of the PR head');
    assert.equal(git(remote, `ls-tree -r --name-only ${preserved.recoveryBranch}`), 'Main.kt\nNOTES.md');
    assert.match(git(remote, `show ${preserved.recoveryBranch}:Main.kt`), /Hello, Kotlin!/);

    // Index and working tree are untouched: the next session still sees them.
    assert.equal(git(work, 'diff --cached --name-only'), '');
    assert.match(await readFile(join(work, 'Main.kt'), 'utf8'), /Hello, Kotlin!/);
    assert.equal(git(work, 'diff --name-only'), 'Main.kt');
    assert.throws(() => git(work, 'cat-file -e :NOTES.md'), 'the private index never leaks into the real one');

    const comment = describePreservedWork(preserved);
    assert.match(comment, /`recovery\/issue-1-604f2202fd18`/);
    assert.match(comment, /the pull request branch was not changed/);
    assert.match(comment, /git push origin --delete recovery\/issue-1-604f2202fd18/, 'one-line instruction to drop it');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('every failure comment names the recovery branch', async () => {
  const exhaustion = await readFile(join(__dirname, '..', 'src', 'auto-restart-exhaustion.lib.mjs'), 'utf8');
  assert.match(exhaustion, /preservedText: describePreservedWork\(preserved\)/);
  const progress = await readFile(join(__dirname, '..', 'src', 'session-progress.lib.mjs'), 'utf8');
  assert.match(progress, /describePreservedWork\(preserved\)/);
  assert.match(progress, /reportNoProgressStop\(\{[^}]*preserved/);
  const helperCode = (await readFile(join(__dirname, '..', 'src', 'critical-error-commit.lib.mjs'), 'utf8')).replace(/^\s*(\/\/|\*).*$/gm, '');
  assert.doesNotMatch(helperCode, /git add -A/, 'the recovery path never stages the whole tree');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
