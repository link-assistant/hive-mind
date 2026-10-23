#!/usr/bin/env node
// Issue #3656: rebuild the PR #3531 working directory (a committed subagent
// gitlink whose worktree moved on) and run the resume's status check from the
// given src/ directory. Usage: node before-after-resume-check.mjs <src-dir>
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const srcDir = path.resolve(process.argv[2] || 'src');
const { verifyDefaultBranchAndStatus } = await import(pathToFileURL(path.join(srcDir, 'solve.repo-setup.lib.mjs')));
const { ensureUseM } = await import(pathToFileURL(path.join(srcDir, 'use-m-bootstrap.lib.mjs')));
const { $: $raw } = await (await ensureUseM())('command-stream');
const $ = options => $raw({ ...options, mirror: false, capture: true });

const root = await mkdtemp(path.join(os.tmpdir(), 'issue-3656-'));
const sh = (cwd, cmd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });
try {
  const ws = path.join(root, 'ws');
  sh(root, 'git init -q --bare -b main origin.git && git clone -q origin.git ws');
  sh(ws, 'git config user.email t@e && git config user.name T && git config commit.gpgsign false');
  await writeFile(path.join(ws, 'README.md'), '# r\n');
  sh(ws, 'git add . && git commit -qm init && git push -q origin main && git checkout -qb issue-3530-6f80c2bef5a1');
  sh(ws, 'git worktree add -q .claude/worktrees/agent-a6f6b1eccdeeb44b8 -b wt && git add -A && git commit -qm auto 2>/dev/null');
  sh(path.join(ws, '.claude/worktrees/agent-a6f6b1eccdeeb44b8'), 'git commit -q --allow-empty -m moved');
  console.log('git status --porcelain:', JSON.stringify(sh(ws, 'git status --porcelain')));
  const lines = [];
  const log = async (m, o = {}) => {
    if (!o.verbose) lines.push(m);
  };
  try {
    const branch = await verifyDefaultBranchAndStatus({ tempDir: ws, log, formatAligned: (_i, l, v) => `${l} ${v}`, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null, existingRepository: true });
    console.log(`RESULT: resumed, default branch = ${branch}`);
  } catch (error) {
    console.log(`RESULT: ${error.message}`);
  }
  console.log(lines.map(l => `  | ${l}`).join('\n'));
} finally {
  await rm(root, { recursive: true, force: true });
}
