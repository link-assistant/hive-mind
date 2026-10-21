#!/usr/bin/env node

/**
 * Regression tests for issue #3656: "Repository has uncommitted changes after
 * clone" on auto resume after limit reset.
 *
 * Claude Code's Agent tool with `isolation: "worktree"` checks every subagent
 * out as a git worktree under `.claude/worktrees/agent-<id>/`. On PR #3531 the
 * auto-commit (`git add -A`) recorded five of them as gitlinks (mode 160000),
 * and the auto-resume in the same working directory then failed before the
 * session even started:
 *
 *     ℹ️  Skipping clone: Using existing repository in working directory
 *     📌 Default branch:           issue-3530-6f80c2bef5a1
 *      M .claude/worktrees/agent-a6f6b1eccdeeb44b8
 *     ...
 *     Error: Repository has uncommitted changes after clone
 *
 * (docs/case-studies/issue-3656/failure-comment-6289611497.md)
 *
 * The test rebuilds that working directory with real git and checks each link
 * of the chain: the commit of the gitlinks, the status check, the resume's
 * "default branch", the restart feedback and the recovery commit.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AI_TOOL_SCRATCH_TRACKED_PATHS, ensureAiToolScratchIgnored, filterAiToolScratchFromStatus, isAiToolScratchPath, isSolverBookkeepingFile, reportTrackedAiToolScratch, stageAllExceptAiToolScratch } from '../src/ai-tool-scratch.lib.mjs';
import { commitUncommittedChangesOnCriticalError } from '../src/critical-error-commit.lib.mjs';
import { verifyDefaultBranchAndStatus } from '../src/solve.repo-setup.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { $: $raw } = await use('command-stream');
const $ = options => $raw({ ...options, mirror: false, capture: true });

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const logs = [];
const log = async (message, options = {}) => {
  if (!options.verbose) logs.push(String(message));
};
const formatAligned = (_icon, label, value) => `${label} ${value}`.trim();
const git = (cwd, ...args) => $({ cwd })`git ${args}`;
const run = async (cwd, command) => {
  const result = await $({ cwd })`sh -c ${command}`;
  assert.equal(result.code, 0, `${command} failed: ${result.stderr?.toString()}${result.stdout?.toString()}`);
  return result.stdout.toString().trim();
};

// --- classification ----------------------------------------------------------
// The five lines from the failure log, verbatim.
const failureStatus = [' M .claude/worktrees/agent-a6f6b1eccdeeb44b8', ' M .claude/worktrees/agent-a758fc82a9ac2def0', ' M .claude/worktrees/agent-a7ccb079b1b6b6c63', ' M .claude/worktrees/agent-a8535b865ad943702', ' M .claude/worktrees/agent-aa7c6edc4e36e9fc6'].join('\n');
assert.equal(filterAiToolScratchFromStatus(failureStatus), '', 'the status from the failure log is AI tool state only');
// Every caller trims the status output first, which strips the first line's
// leading space: `M .claude/worktrees/...` must still be read as that path.
assert.equal(filterAiToolScratchFromStatus(failureStatus.trim()), '', 'a trimmed first line keeps its path');
assert.ok(isAiToolScratchPath('M .claude/worktrees/agent-a6f6b1eccdeeb44b8'));
assert.ok(!isAiToolScratchPath('M src/solve.mjs'), 'a trimmed first line of real work stays');
assert.ok(isAiToolScratchPath('M  .claude/worktrees/agent-a6f6b1eccdeeb44b8'), 'a staged gitlink (XY = "M ") is scratch too');
assert.ok(isAiToolScratchPath('?? .claude/worktrees/agent-a6f6b1eccdeeb44b8/'), 'an untracked subagent worktree is scratch');
assert.ok(isSolverBookkeepingFile('.claude/worktrees/agent-a6f6b1eccdeeb44b8'), 'a committed subagent gitlink is not a pull request change');
// Project configuration under .claude/ is real work and must stay visible.
assert.ok(!isAiToolScratchPath('?? .claude/settings.json'), '.claude/settings.json is project configuration');
assert.ok(!isAiToolScratchPath(' M .claude/agents/reviewer.md'), '.claude/agents/ is project configuration');
assert.ok(!isAiToolScratchPath('?? .claude/worktrees-notes.md'), 'a similarly named file is real work');
assert.ok(AI_TOOL_SCRATCH_TRACKED_PATHS.includes('.claude/worktrees'), 'tracked subagent worktrees are kept out of staging');
assert.ok(!AI_TOOL_SCRATCH_TRACKED_PATHS.includes('data/cache/derivations'), 'a tracked derivations file is still the user’s work (untrackedOnly)');

// --- the working directory of the failed resume ------------------------------
const root = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3656-'));
try {
  const origin = path.join(root, 'origin.git');
  const workspace = path.join(root, 'workspace');
  await run(root, `git init -q --bare -b main ${origin}`);
  await run(root, `git clone -q ${origin} ${workspace}`);
  await run(workspace, 'git config user.email test@example.com && git config user.name Test && git config commit.gpgsign false');
  await writeFile(path.join(workspace, 'README.md'), '# test\n');
  await run(workspace, 'git add README.md && git commit -q -m initial && git push -q origin main && git checkout -q -b issue-3530-6f80c2bef5a1');

  // What Claude Code's Agent tool with isolation: "worktree" leaves behind.
  await run(workspace, 'git worktree add -q .claude/worktrees/agent-a6f6b1eccdeeb44b8 -b worktree-agent-a6f6b1eccdeeb44b8');
  assert.equal(await run(workspace, 'git status --porcelain'), '?? .claude/', 'the subagent worktree shows up as untracked');

  // 1. With the fix, the auto-commit stages nothing of it (even before the
  //    exclude is written, the scratch gitlink is reset out of the index).
  await writeFile(path.join(workspace, 'fix.mjs'), 'export const fixed = true;\n');
  const added = await stageAllExceptAiToolScratch(workspace, $);
  assert.equal(added.code, 0);
  assert.equal(await run(workspace, 'git diff --cached --name-only'), 'fix.mjs', 'only the real change is staged');
  await run(workspace, 'git reset -q');

  // 2. Reproduce the old auto-commit on PR #3531: plain `git add -A`.
  await run(workspace, 'git add -A && git commit -q -m "Auto-commit: Changes made by Claude during problem-solving session"');
  assert.match(await run(workspace, 'git ls-tree HEAD .claude/worktrees/'), /^160000 commit [0-9a-f]+\t\.claude\/worktrees\/agent-a6f6b1eccdeeb44b8$/, 'the subagent worktree was committed as a gitlink');
  await run(workspace, 'git push -q origin issue-3530-6f80c2bef5a1');
  // The subagent keeps working, so the gitlink no longer matches.
  await writeFile(path.join(workspace, '.claude/worktrees/agent-a6f6b1eccdeeb44b8/sub.txt'), 'sub\n');
  await run(path.join(workspace, '.claude/worktrees/agent-a6f6b1eccdeeb44b8'), 'git add sub.txt && git commit -q -m sub');
  assert.equal(await run(workspace, 'git status --porcelain'), 'M .claude/worktrees/agent-a6f6b1eccdeeb44b8', 'the exact status line from the failure log');

  // 3. The resume's status check: it no longer fails, and it reports origin's
  //    default branch rather than the checked-out pull request branch.
  logs.length = 0;
  const defaultBranch = await verifyDefaultBranchAndStatus({ tempDir: workspace, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null, existingRepository: true });
  assert.equal(defaultBranch, 'main', 'the default branch of an existing working directory comes from origin, not from the checked-out branch');
  assert.ok(
    logs.some(line => line.includes('Checked-out branch: issue-3530-6f80c2bef5a1')),
    'the checked-out branch is reported as such'
  );
  assert.ok(!logs.some(line => line.includes('uncommitted changes')), `scratch-only status is clean:\n${logs.join('\n')}`);
  // A fresh clone with only scratch state is clean too.
  assert.equal(await verifyDefaultBranchAndStatus({ tempDir: workspace, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null }), 'issue-3530-6f80c2bef5a1');

  // 4. Real leftovers of an interrupted session are kept on resume, but a
  //    freshly cloned repository with changes is still an error.
  await writeFile(path.join(workspace, 'unfinished.mjs'), 'export const half = 1;\n');
  logs.length = 0;
  assert.equal(await verifyDefaultBranchAndStatus({ tempDir: workspace, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null, existingRepository: true }), 'main');
  assert.ok(logs.some(line => line.includes('uncommitted changes from the previous session')));
  assert.deepEqual(
    logs.filter(line => line.startsWith('   ')),
    ['   ?? unfinished.mjs'],
    'the warning lists only real work'
  );
  await assert.rejects(verifyDefaultBranchAndStatus({ tempDir: workspace, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null }), /Repository has uncommitted changes after clone/);

  // 5. The next auto-commit does not record the moved gitlink again.
  await stageAllExceptAiToolScratch(workspace, $);
  assert.equal(await run(workspace, 'git diff --cached --name-only'), 'unfinished.mjs', 'the moved gitlink stays out of the next commit');
  await run(workspace, 'git reset -q');

  // 6. The recovery commit on a critical error ignores it as well.
  await rm(path.join(workspace, 'unfinished.mjs'));
  logs.length = 0;
  const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: workspace, branchName: 'issue-3530-6f80c2bef5a1', $, log, push: false });
  assert.equal(preserved.committed, false, 'a moved subagent gitlink is not work worth a recovery branch');
  assert.equal((await git(workspace, 'branch', '--list', 'recovery/*')).stdout.toString().trim(), '');
  assert.ok(!logs.some(line => line.includes('preserving uncommitted changes')), 'no 40 s private-index pass for AI tool state alone');
  // With real work next to it, the work is preserved and the gitlink is not.
  await writeFile(path.join(workspace, 'README.md'), '# changed\n');
  const mixed = await commitUncommittedChangesOnCriticalError({ tempDir: workspace, branchName: 'issue-3530-6f80c2bef5a1', $, log, push: false });
  assert.equal(mixed.committed, true);
  assert.deepEqual(mixed.preserved, ['README.md'], 'the moved gitlink is not re-recorded on the recovery branch');
  await run(workspace, `git checkout -q -- README.md && git branch -q -D ${mixed.recoveryBranch}`);

  // 7. The committed gitlinks are reported with a command that removes them.
  logs.length = 0;
  assert.deepEqual(await reportTrackedAiToolScratch(workspace, $, log), ['.claude/worktrees/agent-a6f6b1eccdeeb44b8']);
  const removal = logs.find(line => line.includes('git rm'));
  assert.ok(removal, 'the warning says how to remove the committed scratch');
  await run(workspace, removal.replace(/^.*Remove it with: /, ''));
  assert.equal(await run(workspace, 'git diff --cached --name-status'), 'D\t.claude/worktrees/agent-a6f6b1eccdeeb44b8', 'the suggested command removes the gitlink and nothing else');
  assert.ok(await readFile(path.join(workspace, '.claude/worktrees/agent-a6f6b1eccdeeb44b8/sub.txt'), 'utf8'), 'the subagent worktree itself is untouched');
  await run(workspace, 'git commit -q -m "Remove subagent worktree gitlinks"');
  assert.equal(await run(workspace, 'git status --porcelain'), '', 'after removal the excluded worktree is invisible to git');
  assert.deepEqual(await reportTrackedAiToolScratch(workspace, $, log), []);
} finally {
  await rm(root, { recursive: true, force: true });
}

// --- every status consumer agrees --------------------------------------------
const filtered = ['solve.preparation.lib.mjs', 'solve.minimal-restart-prompt.lib.mjs', 'bidirectional-interactive.lib.mjs', 'solve.repo-setup.lib.mjs'];
for (const file of filtered) {
  const source = await readFile(path.join(repoRoot, 'src', file), 'utf8');
  assert.ok(source.includes('filterAiToolScratchFromStatus'), `${file} drops AI tool scratch from the status it reports`);
}
const autoCommitters = ['claude.uncommitted-changes.lib.mjs', 'codex.lib.mjs', 'agent.lib.mjs', 'opencode.lib.mjs', 'gemini.lib.mjs', 'qwen.lib.mjs', 'agent-commander.lib.mjs'];
for (const file of autoCommitters) {
  const source = await readFile(path.join(repoRoot, 'src', file), 'utf8');
  assert.ok(source.includes('stageAllExceptAiToolScratch(tempDir, $)'), `${file} stages without AI tool scratch`);
  assert.ok(!source.includes('})`git add -A`'), `${file} no longer runs a bare git add -A`);
}
assert.ok((await readFile(path.join(repoRoot, 'src', 'solve.mjs'), 'utf8')).includes('existingRepository: !needsClone'), 'solve tells the status check whether it cloned');

// ensureAiToolScratchIgnored writes the new entry into the exclude file.
const scratch = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3656-exclude-'));
try {
  await run(scratch, 'git init -q');
  await ensureAiToolScratchIgnored(scratch);
  assert.match(await readFile(path.join(scratch, '.git', 'info', 'exclude'), 'utf8'), /^\.claude\/worktrees\/$/m);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log('PASS: issue #3656 Claude Code subagent worktrees are AI tool state, and a resume keeps its working directory');
