#!/usr/bin/env node

/**
 * Regression tests for issue #2119: AI tool scratch state must not look like
 * the AI's uncommitted work.
 *
 * The Scala reproduction run restarted the tool on every iteration because
 * Formal AI writes a `.formal-ai/` plan directory into the workspace it runs in:
 *
 *     🔍 Checking for uncommitted changes...
 *     ?? .formal-ai/
 *     📝 Found uncommitted changes
 *     🔄 AUTO-RESTART: Restarting Agent to handle uncommitted changes...
 *
 * (docs/case-studies/issue-2119/data/logs/agent-scala-solution-draft.log:5425)
 *
 * Restarting recreates the directory, so the blocker could never clear. The same
 * state also reached the `git add -A` on the auto-commit paths, which would have
 * published a tool's private scratch files inside the user's pull request.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AI_TOOL_SCRATCH_PATHS, ensureAiToolScratchIgnored, filterAiToolScratchFromStatus, isAiToolScratchPath } from '../src/ai-tool-scratch.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { $: $raw } = await use('command-stream');
const $ = $raw({ mirror: false, capture: true });

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- classification ----------------------------------------------------------

assert.ok(isAiToolScratchPath('?? .formal-ai/'), 'the exact line from the reproduction log is recognised as scratch state');
assert.ok(isAiToolScratchPath('?? .formal-ai/general-change-plan.lino'), 'files inside the scratch directory count too');
assert.ok(isAiToolScratchPath('?? .playwright-mcp/'), 'the .playwright-mcp case from issue #1124 stays covered');

// Real work must never be filtered away - that would hide the AI's changes.
assert.ok(!isAiToolScratchPath('?? examples'), 'a new examples/ directory is the AI’s actual work');
assert.ok(!isAiToolScratchPath(' M src/solve.mjs'), 'a modified source file is real work');
assert.ok(!isAiToolScratchPath('?? .formal-ai-notes.md'), 'a similarly named file outside the scratch directory is real work');
assert.ok(!isAiToolScratchPath(''), 'an empty line is not a scratch path');

// The exact status output the Scala run saw: only `examples` survives.
assert.equal(filterAiToolScratchFromStatus('?? .formal-ai/\n?? examples'), '?? examples', 'the scratch directory is dropped and the real change is kept');
assert.equal(filterAiToolScratchFromStatus('?? .formal-ai/'), '', 'a workspace containing nothing but scratch state reads as clean - the restart loop stops');
assert.equal(filterAiToolScratchFromStatus(''), '');

// --- the git-level fix -------------------------------------------------------
// `.git/info/exclude` is the single place that makes every git command agree,
// which matters because each tool integration reads git status for itself.
const workspace = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2119-scratch-'));
try {
  await $`git -C ${workspace} init -q`;
  await $`git -C ${workspace} config user.email test@example.com`;
  await $`git -C ${workspace} config user.name Test`;
  await writeFile(path.join(workspace, 'README.md'), '# test\n');
  await $`git -C ${workspace} add README.md`;
  await $`git -C ${workspace} -c commit.gpgsign=false commit -q -m initial`;

  // Reproduce the workspace state: the tool left its plan file behind.
  await mkdir(path.join(workspace, '.formal-ai'), { recursive: true });
  await writeFile(path.join(workspace, '.formal-ai', 'general-change-plan.lino'), 'plan\n');

  const before = (await $`git -C ${workspace} status --porcelain`).stdout.toString().trim();
  assert.equal(before, '?? .formal-ai/', 'without the fix git reports the scratch directory as an untracked change');

  const applied = await ensureAiToolScratchIgnored(workspace);
  assert.equal(applied.applied, true);
  assert.deepEqual(
    applied.added,
    AI_TOOL_SCRATCH_PATHS.map(entry => entry.path)
  );

  const after = (await $`git -C ${workspace} status --porcelain`).stdout.toString().trim();
  assert.equal(after, '', 'git itself now ignores the scratch directory, so every caller agrees');

  // `git add -A` must not publish the tool's scratch files in the pull request.
  await $`git -C ${workspace} add -A`;
  const staged = (await $`git -C ${workspace} diff --cached --name-only`).stdout.toString().trim();
  assert.equal(staged, '', 'the scratch directory is not staged by git add -A');

  // The repository's own .gitignore is untouched: an exclude entry is local to
  // the clone and cannot leak into the diff.
  const tracked = await readdir(workspace);
  assert.ok(!tracked.includes('.gitignore'), 'no .gitignore was created in the workspace');

  // Idempotent: a second call adds nothing, so restarts do not append forever.
  const second = await ensureAiToolScratchIgnored(workspace);
  assert.deepEqual(second.added, [], 're-running adds no duplicate entries');
  const excludeText = await readFile(path.join(workspace, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(excludeText.match(/^\.formal-ai\/$/gm).length, 1, 'the entry appears exactly once');

  // Real work is still detected after the fix - the check must not go blind.
  await writeFile(path.join(workspace, 'hello.scala'), 'object Hello\n');
  const withWork = (await $`git -C ${workspace} status --porcelain`).stdout.toString().trim();
  assert.equal(withWork, '?? hello.scala', 'an actual new file is still reported');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

// --- every tool integration must use it --------------------------------------
// Issue #2119 asks to "fully apply requirements to entire codebase"; there are
// eight copies of checkForUncommittedChanges and fixing one would fix nothing.
const toolLibs = ['qwen.lib.mjs', 'agent.lib.mjs', 'gemini.lib.mjs', 'opencode.lib.mjs', 'claude.lib.mjs', 'codex.lib.mjs', 'agent-commander.lib.mjs', 'solve.restart-shared.lib.mjs'];
for (const file of toolLibs) {
  const source = await readFile(path.join(repoRoot, 'src', file), 'utf8');
  assert.ok(source.includes('checkForUncommittedChanges'), `${file} still defines the check`);
  assert.ok(source.includes('ensureAiToolScratchIgnored'), `${file} excludes AI tool scratch state before reading git status`);
  assert.ok(source.includes('filterAiToolScratchFromStatus'), `${file} filters scratch state out of the status it acts on`);
}

// The workspace is set up once at clone time so the very first check is clean.
const repositorySource = await readFile(path.join(repoRoot, 'src', 'solve.repository.lib.mjs'), 'utf8');
assert.ok(repositorySource.includes('ensureAiToolScratchIgnored(tempDir, log)'), 'the freshly cloned workspace excludes AI tool scratch state');

console.log(`PASS: issue #2119 AI tool scratch state is ignored in ${toolLibs.length} uncommitted-change checks`);
