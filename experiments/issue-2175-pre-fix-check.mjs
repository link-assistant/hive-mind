#!/usr/bin/env node
/**
 * Reproduce the issue #2175 release failure against the PRE-fix library.
 *
 * Replays the exact GH013 rejection from CI run 32589574378 through the version
 * bump logic as it existed before this pull request, showing that it aborts the
 * release (so 2.13.5 was never published) and that the version commit was made
 * with an unattributed bot email.
 *
 * Usage: node experiments/issue-2175-pre-fix-check.mjs [git-ref]
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ref = process.argv[2] || 'origin/main';
const dir = mkdtempSync(join(tmpdir(), 'issue-2175-'));
try {
  // The pre-fix library imports ./run-command.lib.mjs, so keep them together.
  cpSync('scripts/run-command.lib.mjs', join(dir, 'run-command.lib.mjs'));
  writeFileSync(join(dir, 'version-and-commit.lib.mjs'), execFileSync('git', ['show', `${ref}:scripts/version-and-commit.lib.mjs`]));

  const { versionAndCommit, isNonFastForward } = await import(join(dir, 'version-and-commit.lib.mjs'));

  const RULE_VIOLATION = {
    code: 1,
    stdout: '',
    stderr: ['remote: error: GH013: Repository rule violations found for refs/heads/main.', 'remote: - Changes must be made through a pull request.', ' ! [remote rejected]   main -> main (push declined due to repository rule violations)'].join('\n'),
  };

  console.log(`Pre-fix library from ${ref}`);
  console.log('  isNonFastForward(GH013) =', isNonFastForward(RULE_VIOLATION), '(so the rebase-retry loop correctly refuses, but nothing else handles it)');

  const calls = [];
  const outputs = {};
  const runner = async (command, args = []) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    if (key === 'git push origin main') return RULE_VIOLATION;
    if (key === 'git status --porcelain') return { code: 0, stdout: ' M package.json\n', stderr: '' };
    if (key.startsWith('git rev-parse')) return { code: 0, stdout: 'abc123\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };

  try {
    await versionAndCommit({
      mode: 'changeset',
      runner,
      output: (key, value) => (outputs[key] = value),
      readVersion: () => '2.13.5',
      countChangesets: () => 1,
      sleeper: async () => {},
      logger: { log() {}, error() {} },
    });
    console.log('  UNEXPECTED: the release completed', outputs);
  } catch (error) {
    console.log('  release aborted:', error.constructor.name, '-', error.message.split('\n')[0]);
    console.log('  version_committed =', outputs.version_committed, '(2.13.5 never reached npm)');
  }
  console.log(
    ' ',
    calls.find(call => call.startsWith('git config user.email')),
    '(unattributed: no 41898282+ prefix)'
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
