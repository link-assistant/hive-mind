#!/usr/bin/env node
/**
 * Issue #3572 / #3656: Claude Code subagents run with `isolation: "worktree"`
 * leave git worktrees under `.claude/worktrees/agent-<id>/`. The end-of-session
 * auto-commit (`git add -A`) pushed them to the pull request as gitlinks
 * (mode 160000), and the limit-reset auto-resume in the same directory failed:
 *
 *      M .claude/worktrees/agent-a6f6b1eccdeeb44b8
 *     Error: Repository has uncommitted changes after clone
 *         at verifyDefaultBranchAndStatus (src/solve.repo-setup.lib.mjs:285:11)
 *
 * (docs/case-studies/issue-3656/data/pr-3531-comment-6289611497.md)
 *
 * These tests use real git repositories and a real `git worktree add`.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3572
 * @see https://github.com/link-assistant/hive-mind/issues/3656
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureAiToolScratchIgnored, filterAiToolScratchFromStatus, isAiToolScratchPath } from '../src/ai-tool-scratch.lib.mjs';
import { findUnregisteredStagedGitlinks, parseGitlinkPaths, parseRegisteredSubmodulePaths, unstageUnregisteredGitlinks } from '../src/unregistered-gitlinks.lib.mjs';
import { resolveOriginDefaultBranch, verifyDefaultBranchAndStatus } from '../src/solve.repo-setup.lib.mjs';
import { checkForUncommittedChanges } from '../src/claude.uncommitted-changes.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
// The libraries call `$({ cwd, mirror: false })`, so they get the options-taking `$`.
const { $ } = await use('command-stream');
const quiet = $({ mirror: false });

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const formatAligned = (icon, label, value = '') => `${icon} ${label} ${value}`.trim();

const createLog = () => {
  const lines = [];
  const log = async (message = '') => {
    lines.push(String(message));
  };
  return { lines, log };
};

const git = (cwd, ...args) => $({ cwd, mirror: false })`git -c commit.gpgsign=false ${args}`;

/** A bare "origin" with `main`, cloned like solve clones it. */
const createClone = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3572-'));
  const seed = path.join(root, 'seed');
  const origin = path.join(root, 'origin.git');
  const clone = path.join(root, 'clone');
  await mkdir(seed);
  await git(seed, 'init', '-q', '-b', 'main');
  await git(seed, 'config', 'user.email', 'test@example.com');
  await git(seed, 'config', 'user.name', 'Test');
  await writeFile(path.join(seed, 'README.md'), '# test\n');
  await git(seed, 'add', 'README.md');
  await git(seed, 'commit', '-q', '-m', 'initial');
  await quiet`git clone -q --bare ${seed} ${origin}`;
  await quiet`git clone -q ${origin} ${clone}`;
  await git(clone, 'config', 'user.email', 'test@example.com');
  await git(clone, 'config', 'user.name', 'Test');
  return { root, origin, clone };
};

/** What a Claude subagent with `isolation: "worktree"` leaves behind. */
const addClaudeSubagentWorktree = async (clone, id = 'agent-a6f6b1eccdeeb44b8') => {
  const worktreePath = path.join('.claude', 'worktrees', id);
  const result = await git(clone, 'worktree', 'add', '-q', '-b', `worktree-${id}`, worktreePath);
  assert.equal(result.code, 0, `git worktree add failed: ${result.stderr}`);
  return worktreePath;
};

test('.claude/worktrees/ is AI tool state, tracked or not', () => {
  assert.equal(isAiToolScratchPath('?? .claude/worktrees/'), true);
  assert.equal(isAiToolScratchPath(' M .claude/worktrees/agent-a6f6b1eccdeeb44b8'), true, 'a committed gitlink that moved is still tool state');
  assert.equal(isAiToolScratchPath(' M .claude/settings.json'), false, 'the rest of .claude/ is the user’s');
  assert.equal(isAiToolScratchPath('?? .claude/commands/review.md'), false);
  const status = [' M .claude/worktrees/agent-a6f6b1eccdeeb44b8', ' M .claude/worktrees/agent-a758fc82a9ac2def0', ' M src/index.mjs'].join('\n');
  assert.equal(filterAiToolScratchFromStatus(status), ' M src/index.mjs');
  // Callers trim the whole porcelain output, which eats the first line's leading space.
  assert.equal(isAiToolScratchPath('M .claude/worktrees/agent-a6f6b1eccdeeb44b8'), true, 'a trimmed first line is still recognised');
  assert.equal(filterAiToolScratchFromStatus(status.trim()), ' M src/index.mjs');
  assert.equal(isAiToolScratchPath('M src/index.mjs'), false);
  assert.equal(isAiToolScratchPath('MM .playwright-mcp/x.png'), true);
});

test('gitlink and .gitmodules parsing', () => {
  const lsFiles = ['100644 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tREADME.md', '160000 1111111111111111111111111111111111111111 0\t.claude/worktrees/agent-x', '160000 2222222222222222222222222222222222222222 0\tvendor/lib'].join('\0');
  assert.deepEqual(parseGitlinkPaths(lsFiles), ['.claude/worktrees/agent-x', 'vendor/lib']);
  assert.deepEqual([...parseRegisteredSubmodulePaths('submodule.vendor/lib.path vendor/lib\nsubmodule.x.url https://x\n')], ['vendor/lib']);
  assert.deepEqual([...parseRegisteredSubmodulePaths('')], []);
});

test('the exclude written at clone time keeps a real subagent worktree out of git status and git add -A', async () => {
  const { root, clone } = await createClone();
  try {
    await addClaudeSubagentWorktree(clone);
    const before = (await git(clone, 'status', '--porcelain')).stdout.toString().trim();
    assert.equal(before, '?? .claude/', 'without the exclude the worktree shows up as untracked');

    await ensureAiToolScratchIgnored(clone);
    const exclude = await readFile(path.join(clone, '.git', 'info', 'exclude'), 'utf8');
    assert.match(exclude, /^\.claude\/worktrees\/$/m);
    assert.equal((await git(clone, 'status', '--porcelain')).stdout.toString().trim(), '');
    await git(clone, 'add', '-A');
    assert.equal((await git(clone, 'diff', '--cached', '--name-only')).stdout.toString().trim(), '', 'nothing is staged');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the auto-commit does not commit a subagent worktree as a gitlink, but commits the real work', async () => {
  const { root, origin, clone } = await createClone();
  try {
    await git(clone, 'checkout', '-q', '-b', 'issue-3530-6f80c2bef5a1');
    await git(clone, 'push', '-q', 'origin', 'issue-3530-6f80c2bef5a1');
    const worktreePath = await addClaudeSubagentWorktree(clone);
    // The real run's workspace predates the exclude entry; `git add -A` would see the worktree.
    await writeFile(path.join(clone, 'experiments.sh'), 'echo hi\n');

    const { lines, log } = createLog();
    const restart = await checkForUncommittedChanges(clone, 'o', 'r', 'issue-3530-6f80c2bef5a1', $, log, true, false);
    assert.equal(restart, false);

    const committed = (await git(clone, 'show', '--name-only', '--format=', 'HEAD')).stdout.toString().trim();
    assert.equal(committed, 'experiments.sh', 'only the real file is committed');
    const tree = (await git(clone, 'ls-tree', '-r', 'HEAD')).stdout.toString();
    assert.doesNotMatch(tree, /^160000 /m, 'no gitlink is committed');
    const pushed = (await quiet`git --git-dir=${origin} ls-tree -r --name-only issue-3530-6f80c2bef5a1`).stdout.toString();
    assert.doesNotMatch(pushed, /\.claude\/worktrees/);
    assert.ok(
      lines.every(line => !line.includes(worktreePath)),
      'the worktree is not even listed as uncommitted work'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('any nested repository that .gitmodules does not list is unstaged with a log line; a registered submodule is kept', async () => {
  const { root, clone } = await createClone();
  try {
    const createNestedRepository = async relativePath => {
      const nested = path.join(clone, relativePath);
      await mkdir(nested, { recursive: true });
      await git(nested, 'init', '-q');
      await git(nested, 'config', 'user.email', 'test@example.com');
      await git(nested, 'config', 'user.name', 'Test');
      await writeFile(path.join(nested, 'a.txt'), 'a\n');
      await git(nested, 'add', 'a.txt');
      await git(nested, 'commit', '-q', '-m', 'nested');
    };
    // A nested repository outside any scratch path (another tool, a stray clone).
    await createNestedRepository(path.join('tmp-tool', 'nested'));
    // A registered submodule: a nested repository with a .gitmodules entry.
    await createNestedRepository(path.join('vendor', 'lib'));
    await writeFile(path.join(clone, '.gitmodules'), '[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = https://example.com/lib.git\n');
    await writeFile(path.join(clone, 'work.txt'), 'work\n');

    const addResult = await git(clone, 'add', '-A');
    assert.equal(addResult.code, 0);
    assert.deepEqual(await findUnregisteredStagedGitlinks(clone, $), ['tmp-tool/nested']);

    const { lines, log } = createLog();
    assert.deepEqual(await unstageUnregisteredGitlinks(clone, $, log), ['tmp-tool/nested']);
    assert.ok(lines.some(line => line.includes('Not committing embedded git repository tmp-tool/nested')));
    const staged = (await git(clone, 'diff', '--cached', '--name-only')).stdout.toString().trim().split('\n').sort();
    assert.deepEqual(staged, ['.gitmodules', 'vendor/lib', 'work.txt']);
    assert.equal(lines.length, 1, 'the registered submodule is not touched');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a gitlink an earlier auto-commit already pushed is restored to HEAD, not deleted, when it moves', async () => {
  const { root, clone } = await createClone();
  try {
    const worktreePath = await addClaudeSubagentWorktree(clone);
    // Reproduce 06df2d0ad: the gitlink is already in the branch.
    await git(clone, 'add', worktreePath);
    await git(clone, 'commit', '-q', '-m', 'Auto-commit: Changes made by Claude during problem-solving session');
    const headEntry = (await git(clone, 'ls-tree', 'HEAD', worktreePath)).stdout.toString().trim();
    // The subagent keeps working, so its HEAD moves and git reports ` M`.
    await writeFile(path.join(clone, worktreePath, 'more.txt'), 'x\n');
    await git(path.join(clone, worktreePath), 'add', 'more.txt');
    await git(path.join(clone, worktreePath), 'commit', '-q', '-m', 'subagent work');
    await git(clone, 'add', '-A');

    const { log } = createLog();
    assert.deepEqual(await unstageUnregisteredGitlinks(clone, $, log), [worktreePath]);
    assert.equal((await git(clone, 'diff', '--cached', '--name-only')).stdout.toString().trim(), '', 'the moved gitlink is not committed again');
    assert.equal((await git(clone, 'ls-files', '-s', worktreePath)).stdout.toString().trim().split(/\s+/)[1], headEntry.split(/\s+/)[2], 'the index keeps the HEAD entry');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a --working-directory resume passes the clean-tree check despite subagent worktrees, and knows the real default branch', async () => {
  const { root, clone } = await createClone();
  try {
    // The previous session: PR branch checked out, subagent worktrees committed by the old auto-commit.
    await git(clone, 'checkout', '-q', '-b', 'issue-3530-6f80c2bef5a1');
    const worktreePath = await addClaudeSubagentWorktree(clone);
    await git(clone, 'add', worktreePath);
    await git(clone, 'commit', '-q', '-m', 'Auto-commit');
    await writeFile(path.join(clone, worktreePath, 'more.txt'), 'x\n');
    await git(path.join(clone, worktreePath), 'add', 'more.txt');
    await git(path.join(clone, worktreePath), 'commit', '-q', '-m', 'subagent work');
    await addClaudeSubagentWorktree(clone, 'agent-a758fc82a9ac2def0');
    const status = (await git(clone, 'status', '--porcelain')).stdout.toString();
    assert.match(status, /^ M \.claude\/worktrees\/agent-a6f6b1eccdeeb44b8$/m, 'this is the state the real resume found');

    assert.equal(await resolveOriginDefaultBranch(clone, $), 'main');
    const { lines, log } = createLog();
    const defaultBranch = await verifyDefaultBranchAndStatus({ tempDir: clone, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null, reusedWorkingDirectory: true });
    assert.equal(defaultBranch, 'main', 'the PR branch is not reported (and later merged) as the default branch');
    assert.ok(lines.some(line => line.includes('Current branch: issue-3530-6f80c2bef5a1')));
    assert.ok(lines.some(line => line.includes('Default branch: main')));
    assert.ok(lines.some(line => line.includes('Ignoring AI tool state:')));

    // Real work left behind still stops the run, with wording that fits a reused directory.
    await writeFile(path.join(clone, 'README.md'), '# changed\n');
    await assert.rejects(verifyDefaultBranchAndStatus({ tempDir: clone, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null, reusedWorkingDirectory: true }), /uncommitted changes in the reused working directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a fresh clone keeps the old default-branch detection and error wording', async () => {
  const { root, clone } = await createClone();
  try {
    const { lines, log } = createLog();
    assert.equal(await verifyDefaultBranchAndStatus({ tempDir: clone, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null }), 'main');
    assert.ok(lines.some(line => line.includes('Default branch: main')));
    assert.ok(!lines.some(line => line.includes('Current branch:')));
    await writeFile(path.join(clone, 'README.md'), '# changed\n');
    await assert.rejects(verifyDefaultBranchAndStatus({ tempDir: clone, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null }), /uncommitted changes after clone/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every auto-commit path unstages unregistered gitlinks after git add -A, and solve passes the reuse flag', async () => {
  const files = ['agent.lib.mjs', 'agent-commander.lib.mjs', 'gemini.lib.mjs', 'qwen.lib.mjs', 'claude.uncommitted-changes.lib.mjs', 'codex.lib.mjs', 'opencode.lib.mjs'];
  for (const file of files) {
    const source = await readFile(path.join(repoRoot, 'src', file), 'utf8');
    const add = source.indexOf('`git add -A`');
    assert.ok(add > 0, `${file} still auto-commits with git add -A`);
    const unstage = source.indexOf('await unstageUnregisteredGitlinks(tempDir, $, log)', add);
    const commit = source.indexOf('git commit -m', add);
    assert.ok(unstage > add && unstage < commit, `${file} unstages unregistered gitlinks between git add -A and git commit`);
  }
  const solve = await readFile(path.join(repoRoot, 'src', 'solve.mjs'), 'utf8');
  assert.match(solve, /reusedWorkingDirectory: !needsClone/);
  const setup = await readFile(path.join(repoRoot, 'src', 'solve.repo-setup.lib.mjs'), 'utf8');
  assert.match(setup, /Skipping clone: Using existing repository in working directory'\);\n(?:.*\n){0,3}\s*await ensureAiToolScratchIgnored\(tempDir, log\);/);
});
