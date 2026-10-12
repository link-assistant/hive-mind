#!/usr/bin/env node
/**
 * Regression coverage for issue #3001's root cause outside the Docker preflight:
 * command-stream's `$` RESOLVES with `{ code, stdout, stderr }` when a command
 * exits non-zero (its documented default; see its README "Default behavior:
 * Commands don't throw on non-zero exit"). Code written as
 *
 *   try { await $`which bun`; ok(); } catch { notInstalled(); }
 *
 * therefore took the success branch on every failure. The Docker data-root
 * probe logged "could not parse df output" instead of "df failed"; the
 * call sites listed below had the same false negative.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3001
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assertCommandSucceeded } from '../src/command-result.lib.mjs';
import { assertCommandSucceeded as reexported } from '../src/start-command-cli.lib.mjs';
import { commitUncommittedChangesOnCriticalError } from '../src/critical-error-commit.lib.mjs';

test('assertCommandSucceeded returns a zero-exit result unchanged', () => {
  const ok = { code: 0, stdout: 'x', stderr: '' };
  assert.equal(assertCommandSucceeded(ok, 'cmd'), ok);
  assert.equal(assertCommandSucceeded({ stdout: 'no code field' }).stdout, 'no code field');
  assert.equal(reexported, assertCommandSucceeded);
});

test('assertCommandSucceeded throws with code, stderr and a stdout fallback for 2>&1 callers', () => {
  assert.throws(
    () => assertCommandSucceeded({ code: 1, stdout: '', stderr: 'which: no bun in (/usr/bin)\nmore' }, 'which bun'),
    error => error.message === 'which bun exited with code 1: which: no bun in (/usr/bin)' && error.code === 1
  );
  assert.throws(() => assertCommandSucceeded({ code: 128, stdout: 'fatal: not a git repository', stderr: '' }, 'git status'), /git status exited with code 128: fatal: not a git repository/);
});

test('critical-error recovery does not mistake a failed git status for uncommitted changes', async () => {
  const logs = [];
  const calls = [];
  // `git status ... 2>&1` in a broken checkout: the error text lands on stdout.
  const $ =
    () =>
    (strings, ...values) => {
      calls.push(String.raw({ raw: strings }, ...values));
      return Promise.resolve({ code: 128, stdout: 'fatal: not a git repository (or any of the parent directories): .git', stderr: '' });
    };
  const outcome = await commitUncommittedChangesOnCriticalError({ tempDir: '/nonexistent-3001', branchName: 'b', $, log: async m => logs.push(m), push: false });
  assert.deepEqual(outcome, { committed: false, pushed: false });
  assert.equal(calls.length, 1, 'stops after the failed git status');
  assert.ok(!logs.some(m => m.includes('preserving uncommitted changes')), logs.join('\n'));
  assert.ok(
    logs.some(m => m.includes('git status exited with code 128')),
    logs.join('\n')
  );
});

// Call sites that relied on `$` throwing. Each must now route its result
// through assertCommandSucceeded so the existing catch block sees the failure.
const SITES = {
  'src/claude.lib.mjs': ['which start-agent'],
  'src/codex.lib.mjs': ['which start-agent'],
  'src/claude.runtime-switch.lib.mjs': ['which bun', 'which node', 'cp ${claudePath} ${backupPath}', 'cp ${backupPath} ${claudePath}'],
  'src/hive.mjs': ['gh api users/${owner} --jq .type'],
  'src/reviewers-hive.mjs': ['gh api users/${owner} --jq .type'],
  'src/development-log.lib.mjs': ['git reset -q -- ${relativeDirectory}'],
  'src/github.lib.mjs': ['gh project item-list ${projectNumber}'],
  'src/solve.progress-monitoring.lib.mjs': ['--method PATCH --field body=@${tempFile}', 'gh pr edit ${prNumber} --repo ${owner}/${repo} --body-file ${tempBodyFile}'],
  'src/bidirectional-interactive.lib.mjs': ['gh api ${apiPath} --paginate --slurp'],
  'src/critical-error-commit.lib.mjs': ['git status --porcelain --untracked-files=all', 'git rev-parse --git-path hive-mind-recovery.index', 'git update-ref'],
  'src/youtrack/youtrack-sync.mjs': ['--add-label "help wanted"'],
  'src/memory-check.mjs': ['vm_stat 2>/dev/null`'],
  'src/isolation-runner.lib.mjs': ['tmux has-session', 'docker image inspect', 'docker info --format', 'docker rm -f'],
  'src/docker-container-control.lib.mjs': ['docker kill ${containerName}'],
};

for (const [file, commands] of Object.entries(SITES)) {
  test(`${file} checks the exit code of: ${commands.join(' | ')}`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const command of commands) {
      const lines = source.split('\n').filter(line => line.includes(command) && /await\s+[^`]*`/.test(line) && !/\blog\(|console\./.test(line));
      assert.ok(lines.length > 0, `${file}: command not found: ${command}`);
      for (const line of lines) assert.match(line, /assertCommandSucceeded\(/, `${file}: '${command}' must go through assertCommandSucceeded:\n${line.trim()}`);
    }
  });
}
