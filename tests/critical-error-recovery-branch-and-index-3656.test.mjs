#!/usr/bin/env node

/**
 * Critical-error preservation: the recovery branch name (#3572) and the
 * private index (#3656).
 *
 * #3572: the limit-reset auto-resume of PR #3531 failed before solve recorded
 * the PR branch, so the work went to `recovery/detached-head` - one shared name,
 * and the push was skipped. The PR branch was already known.
 *
 * #3656: `commitUncommittedChangesOnCriticalError` took 40 s
 * (11:14:40.729 -> 11:15:20.908) on a loaded container. `GIT_INDEX_FILE=tmp git
 * read-tree HEAD` built an index without a stat cache, so `git add -u` re-hashed
 * every tracked file. The private index is now a copy of the real one, and a
 * status of nothing but AI tool state (`.claude/worktrees/`) skips the step.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3572
 * @see https://github.com/link-assistant/hive-mind/issues/3656
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { $ } from 'command-stream';

import { commitUncommittedChangesOnCriticalError, recoveryBranchFor } from '../src/critical-error-commit.lib.mjs';
import { seedIndexFromRealIndex } from '../src/preserved-files.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFile(join(__dirname, '..', 'src', name), 'utf8');

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
const git = (cwd, command) => execSync(`git ${command}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const refOf = (cwd, ref) => {
  try {
    return git(cwd, `rev-parse --verify -q ${ref}`);
  } catch {
    return null;
  }
};

/** A `$` that runs every command quietly and records its text. */
const spyDollar = () => {
  const commands = [];
  const spy = options => {
    const run = $({ ...options, mirror: false });
    return (strings, ...values) => {
      commands.push(strings.reduce((out, part, index) => out + part + (index < values.length ? String(values[index]) : ''), ''));
      return run(strings, ...values);
    };
  };
  spy.commands = commands;
  return spy;
};

const PR_BRANCH = 'issue-3530-6f80c2bef5a1';

/** A PR branch with two tracked files, pushed to a bare remote. */
const createBranch = async ({ branch = PR_BRANCH } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'hive-3656-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  await mkdir(work);
  execSync(`git init -q --bare ${remote}`);
  git(work, 'init -q');
  git(work, 'config user.name "Hive Mind Test"');
  git(work, 'config user.email hive-mind-test@example.invalid');
  await writeFile(join(work, 'README.md'), '# demo\n');
  await writeFile(join(work, 'main.js'), 'console.log(1);\n');
  git(work, 'add README.md main.js');
  git(work, 'commit -qm init');
  git(work, `branch -M ${branch}`);
  git(work, `remote add origin ${remote}`);
  git(work, `push -qu origin ${branch}`);
  return { root, remote, work, head: git(work, 'rev-parse HEAD') };
};

const TIMESTAMPED_DETACHED = /^recovery\/detached-[0-9a-f]{8}-\d{8}T\d{6}Z$/;

console.log('Issue #3572: the recovery branch is never recovery/detached-head\n');

await test('recoveryBranchFor: PR branch, else detached-<sha8>-<UTC time>', () => {
  const now = Date.UTC(2026, 9, 20, 11, 14, 40, 729);
  assert.equal(recoveryBranchFor(PR_BRANCH), `recovery/${PR_BRANCH}`);
  assert.equal(recoveryBranchFor(null, { sha: 'abcdef0123456789', now }), 'recovery/detached-abcdef01-20261020T111440Z');
  assert.equal(recoveryBranchFor(null, { now }), 'recovery/detached-20261020T111440Z', 'no sha: the time alone');
  assert.equal(recoveryBranchFor(null, { sha: 'not a sha', now }), 'recovery/detached-20261020T111440Z');
  assert.notEqual(recoveryBranchFor(null), 'recovery/detached-head');
  assert.notEqual(recoveryBranchFor(undefined), 'recovery/detached-head');
});

await test('branchName not recorded yet: the known PR branch names the recovery branch, and it is pushed', async () => {
  const { root, remote, work, head } = await createBranch();
  try {
    git(work, 'checkout -q --detach');
    await writeFile(join(work, 'main.js'), 'console.log(2);\n');
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: null, fallbackBranchName: PR_BRANCH, $: spyDollar(), log: silentLog, reason: 'execution error' });
    assert.equal(preserved.recoveryBranch, `recovery/${PR_BRANCH}`);
    assert.equal(preserved.committed, true);
    assert.equal(preserved.pushed, true, 'the push is no longer skipped without branchName');
    assert.equal(refOf(remote, `refs/heads/recovery/${PR_BRANCH}`), preserved.commit);
    assert.equal(refOf(remote, `refs/heads/${PR_BRANCH}`), head, 'the PR branch is not changed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('no branch passed: the checked-out branch names the recovery branch', async () => {
  const { root, remote, work } = await createBranch({ branch: 'issue-7-abc' });
  try {
    await writeFile(join(work, 'main.js'), 'console.log(3);\n');
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: null, $: spyDollar(), log: silentLog });
    assert.equal(preserved.recoveryBranch, 'recovery/issue-7-abc');
    assert.equal(refOf(remote, 'refs/heads/recovery/issue-7-abc'), preserved.commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('nothing known and a detached HEAD: recovery/detached-<sha8>-<time>, pushed', async () => {
  const { root, remote, work, head } = await createBranch();
  try {
    git(work, 'checkout -q --detach');
    await writeFile(join(work, 'main.js'), 'console.log(4);\n');
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: null, $: spyDollar(), log: silentLog });
    assert.match(preserved.recoveryBranch, TIMESTAMPED_DETACHED);
    assert.ok(preserved.recoveryBranch.startsWith(`recovery/detached-${head.slice(0, 8)}-`), 'named after the commit it starts from');
    assert.notEqual(preserved.recoveryBranch, 'recovery/detached-head');
    assert.equal(preserved.pushed, true);
    assert.equal(refOf(remote, `refs/heads/${preserved.recoveryBranch}`), preserved.commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('wiring: solve passes the PR branch it resolved to the failure handler', async () => {
  assert.match(await readSrc('solve.mjs'), /cleanupContext\.prBranch = prBranch \|\| null;/);
  assert.match(await readSrc('solve.error-handlers.lib.mjs'), /fallbackBranchName: cleanupContext\.prBranch \|\| null/);
  const helper = (await readSrc('critical-error-commit.lib.mjs')).replace(/^\s*(\/\/|\*).*$/gm, '');
  assert.doesNotMatch(helper, /detached-head/);
});

console.log('\nIssue #3656: the private index starts from the real one\n');

await test('a real index exists: no read-tree, only the changed file is preserved', async () => {
  const { root, work, head } = await createBranch();
  try {
    await writeFile(join(work, 'main.js'), 'console.log(5);\n');
    const spy = spyDollar();
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: PR_BRANCH, $: spy, log: silentLog });
    assert.equal(preserved.committed, true);
    assert.deepEqual(preserved.preserved, ['main.js']);
    assert.ok(!spy.commands.some(command => command.includes('read-tree')), `read-tree must not run: ${spy.commands.join(' | ')}`);
    assert.ok(spy.commands.some(command => command.includes('git rev-parse --git-path index')));
    assert.equal(git(work, 'rev-parse HEAD'), head);
    assert.equal(git(work, 'diff --cached --name-only'), '', 'the real index is not changed');
    assert.ok(!existsSync(join(work, '.git', 'hive-mind-recovery.index')), 'the private index is removed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('a staged-only new file is preserved (read-tree HEAD used to drop it)', async () => {
  const { root, work } = await createBranch();
  try {
    await writeFile(join(work, 'staged.js'), 'export const staged = true;\n');
    git(work, 'add staged.js');
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: PR_BRANCH, $: spyDollar(), log: silentLog });
    assert.equal(preserved.committed, true);
    assert.deepEqual(preserved.preserved, ['staged.js']);
    assert.equal(git(work, `show ${preserved.commit}:staged.js`), 'export const staged = true;');
    assert.equal(git(work, 'diff --cached --name-only'), 'staged.js', 'still staged in the real index');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('no real index: falls back to read-tree HEAD and still preserves the change', async () => {
  const { root, work } = await createBranch();
  try {
    await writeFile(join(work, 'main.js'), 'console.log(6);\n');
    await rm(join(work, '.git', 'index'));
    const spy = spyDollar();
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: PR_BRANCH, $: spy, log: silentLog });
    assert.ok(
      spy.commands.some(command => command.includes('git read-tree HEAD')),
      'read-tree is the fallback'
    );
    assert.equal(preserved.committed, true);
    assert.deepEqual(preserved.preserved, ['main.js']);
    assert.equal(git(work, `show ${preserved.commit}:main.js`), 'console.log(6);');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('seedIndexFromRealIndex: copies a file, answers false (never throws) otherwise', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-3656-seed-'));
  try {
    await writeFile(join(root, 'index'), 'DIRC');
    assert.equal(await seedIndexFromRealIndex({ cwd: root, realIndexPath: 'index', indexFile: join(root, 'copy') }), true);
    assert.equal(await readFile(join(root, 'copy'), 'utf8'), 'DIRC');
    assert.equal(await seedIndexFromRealIndex({ cwd: root, realIndexPath: 'missing', indexFile: join(root, 'copy2') }), false);
    assert.equal(await seedIndexFromRealIndex({ cwd: root, realIndexPath: '', indexFile: join(root, 'copy3') }), false);
    await mkdir(join(root, 'dir'));
    assert.equal(await seedIndexFromRealIndex({ cwd: root, realIndexPath: 'dir', indexFile: join(root, 'copy4') }), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('only AI tool state uncommitted (the #3656 incident): the step is skipped before any index work', async () => {
  const { root, remote, work, head } = await createBranch();
  try {
    // The incident: `.claude/worktrees/agent-*` committed as gitlinks (#3572), then moved on.
    const agent = join(work, '.claude', 'worktrees', 'agent-a6f6b1eccdeeb44b8');
    await mkdir(agent, { recursive: true });
    git(agent, 'init -q');
    git(agent, 'config user.name "Hive Mind Test"');
    git(agent, 'config user.email hive-mind-test@example.invalid');
    git(agent, 'commit -q --allow-empty -m one');
    git(work, 'add .claude/worktrees/agent-a6f6b1eccdeeb44b8');
    git(work, 'commit -qm "gitlink"');
    git(agent, 'commit -q --allow-empty -m two');
    await mkdir(join(work, '.formal-ai'), { recursive: true });
    await writeFile(join(work, '.formal-ai', 'state.json'), '{}\n');
    const status = execSync('git status --porcelain --untracked-files=all', { cwd: work, encoding: 'utf8' });
    assert.match(status, /^ M \.claude\/worktrees\/agent-a6f6b1eccdeeb44b8$/m, 'the first status line starts with a space');

    const spy = spyDollar();
    const lines = [];
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: PR_BRANCH, $: spy, log: async message => lines.push(String(message)), reason: 'execution error' });
    assert.equal(preserved.committed, false);
    assert.equal(preserved.pushed, false);
    assert.deepEqual(preserved.skipped.sort(), ['.claude/worktrees/agent-a6f6b1eccdeeb44b8', '.formal-ai/state.json']);
    const indexWork = spy.commands.filter(command => /rev-parse --git-path|read-tree|git add|write-tree|commit-tree|ls-files|git push/.test(command));
    assert.deepEqual(indexWork, [], `no index work for AI tool state: ${indexWork.join(' | ')}`);
    assert.match(lines.join('\n'), /Only AI tool state is uncommitted/);
    assert.equal(refOf(remote, `refs/heads/recovery/${PR_BRANCH}`), null, 'no recovery branch');
    assert.equal(refOf(work, `refs/heads/recovery/${PR_BRANCH}`), null);
    assert.notEqual(git(work, 'rev-parse HEAD'), head);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('AI tool state next to real work: the real work is still preserved', async () => {
  const { root, work } = await createBranch();
  try {
    await mkdir(join(work, '.claude', 'worktrees', 'agent-x'), { recursive: true });
    await writeFile(join(work, '.claude', 'worktrees', 'agent-x', 'scratch.txt'), 'scratch\n');
    await writeFile(join(work, 'main.js'), 'console.log(7);\n');
    const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: PR_BRANCH, $: spyDollar(), log: silentLog });
    assert.equal(preserved.committed, true);
    assert.deepEqual(preserved.preserved, ['main.js']);
    assert.deepEqual(preserved.skipped, ['.claude/worktrees/agent-x/scratch.txt']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
