#!/usr/bin/env node

/**
 * Coverage for issue #1772 follow-up: proactive base branch sync should be smart.
 *
 * - Skip sync when no upstream remote is configured (no-fork mode).
 * - Skip sync when the requested base branch equals the default branch (already synced).
 * - Skip sync when origin already has the base branch (idempotent).
 *
 * The reactive recovery path is exercised by `test-issue-1772-fork-custom-base-branch.mjs`.
 */

import assert from 'assert';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createOrCheckoutBranch } from '../src/solve.branch.lib.mjs';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(command, cwd) {
  const result = spawnSync('bash', ['-lc', command], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error([`Command failed: ${command}`, `cwd: ${cwd}`, `exit: ${result.status}`, `stdout: ${result.stdout}`, `stderr: ${result.stderr}`].join('\n'));
  }
  return result.stdout.toString();
}

function createDollar() {
  return options =>
    (strings, ...values) => {
      const command = strings.reduce((acc, part, index) => {
        const value = index < values.length ? shellQuote(values[index]) : '';
        return acc + part + value;
      }, '');
      const result = spawnSync('bash', ['-lc', command], { cwd: options?.cwd, encoding: 'utf8' });
      return Promise.resolve({
        code: result.status ?? 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      });
    };
}

function write(path, contents) {
  writeFileSync(path, contents, 'utf8');
}

function makeIssueIdProvider(suffix) {
  return {
    randomBytes: () => Buffer.from(suffix, 'hex'),
  };
}

const customBaseBranch = 'feat/custom-base';

const tempRoot = mkdtempSync(join(tmpdir(), 'hive-issue-1772-proactive-'));

try {
  // === Scenario 1: no upstream remote (no-fork mode) ===
  // The branch creation must not attempt any upstream fetch and must succeed from origin/<baseBranch>.
  {
    const upstreamWork = join(tempRoot, 's1-upstream-work');
    const originBare = join(tempRoot, 's1-origin.git');
    const workDir = join(tempRoot, 's1-work');

    mkdirSync(upstreamWork);
    run('git init', upstreamWork);
    run('git config user.email "test@example.com"', upstreamWork);
    run('git config user.name "Test User"', upstreamWork);
    write(join(upstreamWork, 'README.md'), '# repo\n');
    run('git add README.md', upstreamWork);
    run('git commit -m "Initial"', upstreamWork);
    run('git branch -M main', upstreamWork);
    run(`git checkout -b ${shellQuote(customBaseBranch)}`, upstreamWork);
    write(join(upstreamWork, 'feature.txt'), 'feature\n');
    run('git add feature.txt', upstreamWork);
    run('git commit -m "Feature"', upstreamWork);
    run('git checkout main', upstreamWork);

    run(`git clone --bare ${shellQuote(upstreamWork)} ${shellQuote(originBare)}`, tempRoot);
    run(`git clone ${shellQuote(originBare)} ${shellQuote(workDir)}`, tempRoot);
    run('git config user.email "test@example.com"', workDir);
    run('git config user.name "Test User"', workDir);
    run(`git fetch origin ${shellQuote(customBaseBranch)}:refs/remotes/origin/${customBaseBranch}`, workDir);
    run('git checkout main', workDir);

    const logLines = [];
    const branchName = await createOrCheckoutBranch({
      isContinueMode: false,
      prBranch: null,
      issueNumber: 100,
      tempDir: workDir,
      defaultBranch: 'main',
      argv: { baseBranch: customBaseBranch, verbose: true },
      log: async message => logLines.push(String(message)),
      formatAligned: (icon, label, value) => `${icon} ${label} ${value}`,
      $: createDollar(),
      crypto: makeIssueIdProvider('aaaaaaaaaaaa'),
      owner: 'owner',
      repo: 'repo',
    });

    assert.strictEqual(branchName, 'issue-100-aaaaaaaaaaaa');
    assert.strictEqual(run('git branch --show-current', workDir).trim(), branchName);

    const joinedLogs = logLines.join('\n');
    assert(!joinedLogs.includes('Syncing base branch:'), 'should NOT attempt proactive sync when no upstream remote');
    assert(!joinedLogs.includes('Base branch not in fork:'), 'should NOT log reactive recovery in no-upstream mode');
    console.log('PASS scenario 1: no upstream remote bypasses proactive sync');
  }

  // === Scenario 2: baseBranch === defaultBranch (already synced by setupUpstreamAndSync) ===
  {
    const upstreamWork = join(tempRoot, 's2-upstream-work');
    const upstreamBare = join(tempRoot, 's2-upstream.git');
    const forkBare = join(tempRoot, 's2-fork.git');
    const workDir = join(tempRoot, 's2-work');

    mkdirSync(upstreamWork);
    run('git init', upstreamWork);
    run('git config user.email "test@example.com"', upstreamWork);
    run('git config user.name "Test User"', upstreamWork);
    write(join(upstreamWork, 'README.md'), '# repo\n');
    run('git add README.md', upstreamWork);
    run('git commit -m "Initial"', upstreamWork);
    run('git branch -M main', upstreamWork);

    run(`git clone --bare ${shellQuote(upstreamWork)} ${shellQuote(upstreamBare)}`, tempRoot);
    run(`git clone --bare ${shellQuote(upstreamBare)} ${shellQuote(forkBare)}`, tempRoot);
    run(`git clone ${shellQuote(forkBare)} ${shellQuote(workDir)}`, tempRoot);
    run('git config user.email "test@example.com"', workDir);
    run('git config user.name "Test User"', workDir);
    run(`git remote add upstream ${shellQuote(upstreamBare)}`, workDir);
    run('git fetch upstream', workDir);
    run('git checkout main', workDir);

    const logLines = [];
    const branchName = await createOrCheckoutBranch({
      isContinueMode: false,
      prBranch: null,
      issueNumber: 200,
      tempDir: workDir,
      defaultBranch: 'main',
      argv: { baseBranch: 'main', verbose: true },
      log: async message => logLines.push(String(message)),
      formatAligned: (icon, label, value) => `${icon} ${label} ${value}`,
      $: createDollar(),
      crypto: makeIssueIdProvider('bbbbbbbbbbbb'),
      owner: 'owner',
      repo: 'repo',
    });

    assert.strictEqual(branchName, 'issue-200-bbbbbbbbbbbb');
    const joinedLogs = logLines.join('\n');
    assert(!joinedLogs.includes('Syncing base branch:'), 'should NOT proactively sync when baseBranch equals defaultBranch');
    console.log('PASS scenario 2: baseBranch == defaultBranch is a no-op');
  }

  // === Scenario 3: origin already has the requested base branch (idempotent fast path) ===
  {
    const upstreamWork = join(tempRoot, 's3-upstream-work');
    const upstreamBare = join(tempRoot, 's3-upstream.git');
    const forkBare = join(tempRoot, 's3-fork.git');
    const workDir = join(tempRoot, 's3-work');

    mkdirSync(upstreamWork);
    run('git init', upstreamWork);
    run('git config user.email "test@example.com"', upstreamWork);
    run('git config user.name "Test User"', upstreamWork);
    write(join(upstreamWork, 'README.md'), '# repo\n');
    run('git add README.md', upstreamWork);
    run('git commit -m "Initial"', upstreamWork);
    run('git branch -M main', upstreamWork);
    run(`git checkout -b ${shellQuote(customBaseBranch)}`, upstreamWork);
    write(join(upstreamWork, 'feature.txt'), 'feature\n');
    run('git add feature.txt', upstreamWork);
    run('git commit -m "Feature"', upstreamWork);
    run('git checkout main', upstreamWork);

    run(`git clone --bare ${shellQuote(upstreamWork)} ${shellQuote(upstreamBare)}`, tempRoot);
    // Fork includes the custom base branch (full clone, like a fresh `gh repo fork`).
    run(`git clone --bare ${shellQuote(upstreamBare)} ${shellQuote(forkBare)}`, tempRoot);
    run(`git clone ${shellQuote(forkBare)} ${shellQuote(workDir)}`, tempRoot);
    run('git config user.email "test@example.com"', workDir);
    run('git config user.name "Test User"', workDir);
    run(`git remote add upstream ${shellQuote(upstreamBare)}`, workDir);
    run('git fetch upstream', workDir);
    run(`git fetch origin ${shellQuote(customBaseBranch)}:refs/remotes/origin/${customBaseBranch}`, workDir);
    run('git checkout main', workDir);

    const logLines = [];
    const branchName = await createOrCheckoutBranch({
      isContinueMode: false,
      prBranch: null,
      issueNumber: 300,
      tempDir: workDir,
      defaultBranch: 'main',
      argv: { baseBranch: customBaseBranch, verbose: true },
      log: async message => logLines.push(String(message)),
      formatAligned: (icon, label, value) => `${icon} ${label} ${value}`,
      $: createDollar(),
      crypto: makeIssueIdProvider('cccccccccccc'),
      owner: 'owner',
      repo: 'repo',
    });

    assert.strictEqual(branchName, 'issue-300-cccccccccccc');
    const joinedLogs = logLines.join('\n');
    assert(!joinedLogs.includes('Syncing base branch:'), 'should NOT proactively sync when origin already has the base');
    assert(!joinedLogs.includes('Base branch not in fork:'), 'should NOT trigger reactive recovery either');
    console.log('PASS scenario 3: origin already has base branch - idempotent skip');
  }

  console.log('PASS issue #1772 proactive base branch sync coverage');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
