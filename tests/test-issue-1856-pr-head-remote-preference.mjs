#!/usr/bin/env node
// @hive-mind-test-suite default

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutPrBranch } from '../src/solve.repository.lib.mjs';

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

const tempRoot = mkdtempSync(join(tmpdir(), 'hive-issue-1856-pr-remote-'));

try {
  const upstreamWork = join(tempRoot, 'upstream-work');
  const upstreamBare = join(tempRoot, 'upstream.git');
  const forkBare = join(tempRoot, 'fork.git');
  const forkWork = join(tempRoot, 'fork-work');
  const workDir = join(tempRoot, 'solver-work');

  mkdirSync(upstreamWork);
  run('git init', upstreamWork);
  run('git config user.email "test@example.com"', upstreamWork);
  run('git config user.name "Test User"', upstreamWork);
  write(join(upstreamWork, 'README.md'), '# repo\n');
  run('git add README.md', upstreamWork);
  run('git commit -m "Initial"', upstreamWork);
  run('git branch -M main', upstreamWork);
  run('git checkout -b renovate/all', upstreamWork);
  write(join(upstreamWork, 'source.txt'), 'upstream-pr-head\n');
  run('git add source.txt', upstreamWork);
  run('git commit -m "Upstream PR branch"', upstreamWork);
  const upstreamPrHead = run('git rev-parse HEAD', upstreamWork).trim();
  run('git checkout main', upstreamWork);

  run(`git clone --bare ${shellQuote(upstreamWork)} ${shellQuote(upstreamBare)}`, tempRoot);
  run(`git clone --bare ${shellQuote(upstreamBare)} ${shellQuote(forkBare)}`, tempRoot);

  run(`git clone ${shellQuote(forkBare)} ${shellQuote(forkWork)}`, tempRoot);
  run('git config user.email "test@example.com"', forkWork);
  run('git config user.name "Test User"', forkWork);
  run('git checkout main', forkWork);
  run('git checkout -B renovate/all', forkWork);
  write(join(forkWork, 'source.txt'), 'stale-fork-branch\n');
  run('git add source.txt', forkWork);
  run('git commit -m "Stale fork branch"', forkWork);
  run('git push --force origin renovate/all', forkWork);

  run(`git clone ${shellQuote(forkBare)} ${shellQuote(workDir)}`, tempRoot);
  run('git config user.email "test@example.com"', workDir);
  run('git config user.name "Test User"', workDir);
  run(`git remote add upstream ${shellQuote(upstreamBare)}`, workDir);
  run('git checkout main', workDir);

  const logLines = [];
  const checkoutResult = await checkoutPrBranch(workDir, 'renovate/all', null, null, 381, {
    preferredRemote: 'upstream',
    $: createDollar(),
    log: async message => logLines.push(String(message)),
    formatAligned: (icon, label, value) => `${icon} ${label} ${value}`,
  });

  assert.equal(checkoutResult.code, 0);
  assert.equal(run('git rev-parse HEAD', workDir).trim(), upstreamPrHead);
  assert.equal(run('cat source.txt', workDir).trim(), 'upstream-pr-head');
  assert.match(logLines.join('\n'), /Preferred PR head remote/);

  console.log('PASS issue #1856 PR head remote preference');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
