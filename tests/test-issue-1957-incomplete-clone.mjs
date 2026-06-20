#!/usr/bin/env node

/**
 * Regression coverage for issue #1957.
 *
 * A `/solve` run failed with the bare, unactionable message "Failed to get
 * current branch". The root cause: `gh repo clone` exited 0 even though the
 * underlying git transfer was interrupted
 * ("fetch-pack: unexpected disconnect while reading sideband packet"),
 * leaving NO `.git` directory. The solver trusted the exit code, logged
 * "✅ Cloned to:", then crashed several git commands later with a message
 * that told the user nothing about what went wrong or how to fix it.
 *
 * These tests verify:
 *   1. The interrupted-transfer output is classified as a retryable NETWORK
 *      error (classifyCloneError) so the clone is retried, not failed.
 *   2. isTransientNetworkError recognises the same git fetch-pack/sideband
 *      disconnect patterns (shared retry helper).
 *   3. cleanPartialClone empties a directory so a retry can start fresh.
 *   4. verifyDefaultBranchAndStatus turns the downstream "not a git
 *      repository" symptom into an actionable "INCOMPLETE CLONE" error
 *      instead of the bare "Failed to get current branch".
 */

import assert from 'assert';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import { classifyCloneError, cleanPartialClone } from '../src/solve.repository.lib.mjs';
import { isTransientNetworkError } from '../src/lib.mjs';
import { verifyDefaultBranchAndStatus } from '../src/solve.repo-setup.lib.mjs';

let passed = 0;
const check = (label, condition) => {
  assert(condition, label);
  passed += 1;
};

// ---------------------------------------------------------------------------
// 1. classifyCloneError — the exact phrase from the issue must be retryable.
// ---------------------------------------------------------------------------
const sidebandError = "Cloning into '/tmp/gh-issue-solver-1781955620326'...\nfetch-pack: unexpected disconnect while reading sideband packet";
const sidebandClass = classifyCloneError(sidebandError);
check('sideband disconnect is classified as NETWORK', sidebandClass.type === 'NETWORK');
check('sideband disconnect is retryable', sidebandClass.retryable === true);

for (const phrase of ['early EOF', 'The remote end hung up unexpectedly', 'RPC failed; curl 56', 'index-pack failed', 'fatal: unexpected disconnect while reading sideband packet']) {
  const c = classifyCloneError(`fatal: ${phrase}`);
  check(`"${phrase}" is retryable`, c.retryable === true && c.type === 'NETWORK');
}

// Non-retryable errors must stay non-retryable (no over-broad matching).
check('404 stays non-retryable', classifyCloneError('error: 404 Not Found').retryable === false);
check('ENOSPC stays non-retryable', classifyCloneError('fatal: write error: No space left on device').retryable === false);
check('auth failure stays non-retryable', classifyCloneError('fatal: Authentication failed').retryable === false);

// ---------------------------------------------------------------------------
// 2. isTransientNetworkError — shared helper recognises the same patterns.
// ---------------------------------------------------------------------------
check('isTransientNetworkError: sideband disconnect', isTransientNetworkError({ message: 'fetch-pack: unexpected disconnect while reading sideband packet' }) === true);
check('isTransientNetworkError: early eof', isTransientNetworkError({ message: 'fatal: early EOF' }) === true);
check('isTransientNetworkError: remote hung up', isTransientNetworkError({ message: 'The remote end hung up unexpectedly' }) === true);
check('isTransientNetworkError: ignores 404', isTransientNetworkError({ message: 'HTTP 404 Not Found' }) === false);

// ---------------------------------------------------------------------------
// 3. cleanPartialClone — empties a directory in place (does not remove it).
// ---------------------------------------------------------------------------
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-1957-clean-'));
  await fs.mkdir(path.join(dir, '.git'), { recursive: true });
  await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
  await fs.writeFile(path.join(dir, 'partial.txt'), 'leftover');

  await cleanPartialClone(dir);

  const remaining = await fs.readdir(dir);
  check('cleanPartialClone removes all leftovers', remaining.length === 0);
  // Directory itself still exists (it was created up-front by setupTempDirectory).
  const stat = await fs.stat(dir);
  check('cleanPartialClone keeps the directory itself', stat.isDirectory());
  await fs.rm(dir, { recursive: true, force: true });

  // Non-existent directory must not throw.
  await cleanPartialClone(path.join(os.tmpdir(), 'issue-1957-does-not-exist-xyz'));
  check('cleanPartialClone tolerates a missing directory', true);
}

// ---------------------------------------------------------------------------
// 4. verifyDefaultBranchAndStatus — actionable error on incomplete clone.
// ---------------------------------------------------------------------------
function createMockDollar({ commands }) {
  const runCommand = command => {
    const response = commands[command];
    if (!response) {
      throw new Error(`Unexpected command: ${command}`);
    }
    return {
      code: response.code ?? 0,
      stdout: Buffer.from(response.stdout ?? ''),
      stderr: Buffer.from(response.stderr ?? ''),
    };
  };
  const tag = (strings, ...values) => {
    const command = strings.reduce((acc, part, index) => acc + part + (values[index] ?? ''), '');
    return Promise.resolve(runCommand(command));
  };
  const dollar = options => {
    if (options && typeof options === 'object' && 'cwd' in options) {
      return tag;
    }
    return tag(options);
  };
  return dollar;
}

{
  const logs = [];
  const log = async message => {
    logs.push(String(message));
  };
  const formatAligned = (_icon, label, value) => `${label} ${value}`.trim();

  // Simulates the exact downstream symptom: the clone produced no .git, so every
  // git command reports "fatal: not a git repository".
  const $ = createMockDollar({
    commands: {
      'git branch --show-current': {
        code: 128,
        stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
      },
    },
  });

  let threw = false;
  try {
    await verifyDefaultBranchAndStatus({
      tempDir: '/tmp/gh-issue-solver-incomplete',
      log,
      formatAligned,
      $,
      argv: {},
      owner: 'G-Ivan-A',
      repo: 'mango_ba_prompts',
      issueUrl: 'https://github.com/G-Ivan-A/mango_ba_prompts/issues/141',
    });
  } catch (error) {
    threw = true;
    check('incomplete clone throws an explanatory error message', /incomplete clone/i.test(error.message));
  }
  check('incomplete clone still throws', threw === true);
  check(
    'logs name the incomplete-clone root cause',
    logs.some(line => /INCOMPLETE CLONE DETECTED/.test(line))
  );
  check(
    'logs give a concrete "How to fix" section',
    logs.some(line => /How to fix/.test(line))
  );
  check(
    'logs surface the underlying git error',
    logs.some(line => /not a git repository/.test(line))
  );
  check(
    'logs suggest re-running',
    logs.some(line => /Re-run the command/i.test(line))
  );
}

// A genuine non-git-repo-but-readable failure keeps the generic branch error.
{
  const logs = [];
  const log = async message => {
    logs.push(String(message));
  };
  const formatAligned = (_icon, label, value) => `${label} ${value}`.trim();
  const $ = createMockDollar({
    commands: {
      'git branch --show-current': { code: 1, stderr: 'some other git failure\n' },
    },
  });
  let threw = false;
  try {
    await verifyDefaultBranchAndStatus({ tempDir: '/tmp/x', log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null });
  } catch (error) {
    threw = true;
    check('generic branch failure throws', /Failed to get current branch/.test(error.message));
  }
  check('generic branch failure still throws', threw === true);
  check('generic branch failure does not mislabel as incomplete clone', !logs.some(line => /INCOMPLETE CLONE DETECTED/.test(line)));
}

console.log(`PASS issue #1957 incomplete-clone regression (${passed} assertions)`);
