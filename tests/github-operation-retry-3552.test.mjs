#!/usr/bin/env node
/**
 * Issue #3552 follow-up: every GitHub operation goes through one retry loop,
 * `retryGitHubOperation` (src/github-operation-retry.lib.mjs).
 *
 * The bug this pins: command-stream's `$` *resolves* `{ code, stderr }` on a
 * non-zero exit instead of rejecting, and `ghWithRateLimitRetry` only retried
 * a rejection - so every `$\`gh ...\`` issued through `wrapDollarWithGhRetry`
 * ran exactly once, even on `HTTP 502` or `API rate limit exceeded`. The mocks
 * in older tests threw, which is why it went unnoticed; the last test here
 * drives the real command-stream `$` against a fake `gh` on PATH.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { classifyGitHubCommand, execSyncWithRetry, isFailedCommandResult, retryGitHubOperation, retryGitHubOperationSync, wrapRunnerWithTransientRetry } from '../src/github-operation-retry.lib.mjs';
import { ghWithRateLimitRetry, wrapDollarWithGhRetry, wrapRunnerWithGitHubRetry } from '../src/github-rate-limit.lib.mjs';
import { wrapDollarWithGitRetry } from '../src/git-retry.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const noSleep = async () => {};
const quiet = () => {};
const BAD_GATEWAY = 'HTTP 502: Bad Gateway (https://api.github.com/graphql)';
const failed = stderr => ({ code: 1, stdout: '', stderr });

test('classifyGitHubCommand recognises gh API calls and network git, in both call styles', () => {
  assert.equal(classifyGitHubCommand('gh api repos/o/r')?.tool, 'gh');
  assert.equal(classifyGitHubCommand('gh', ['pr', 'view', '1'])?.label, 'gh pr view');
  assert.equal(classifyGitHubCommand('/usr/bin/gh', ['auth', 'status'])?.tool, 'gh', 'auth status hits the API');
  assert.equal(classifyGitHubCommand('git -C /tmp/x push origin main')?.subcommand, 'push');
  assert.equal(classifyGitHubCommand('git', ['fetch', 'origin'])?.label, 'git fetch');
  for (const [command, args] of [['gh --version'], ['gh', ['auth', 'token']], ['gh', ['config', 'get', 'editor']], ['git', ['status']], ['git commit -m x'], ['npm', ['publish']]]) {
    assert.equal(classifyGitHubCommand(command, args), null, `${command} ${args ?? ''} is local`);
  }
});

test('isFailedCommandResult only matches a failed process result', () => {
  assert.equal(isFailedCommandResult(failed('x')), true);
  assert.equal(isFailedCommandResult({ code: 0, stdout: 'ok' }), false);
  assert.equal(isFailedCommandResult({ code: 404, message: 'API payload, not a process' }), false);
  assert.equal(isFailedCommandResult(null), false);
});

test('a resolved transient failure is retried and the success is returned', async () => {
  let calls = 0;
  const result = await retryGitHubOperation(async () => (++calls < 3 ? failed(BAD_GATEWAY) : { code: 0, stdout: 'ok', stderr: '' }), { sleep: noSleep, log: quiet });
  assert.equal(calls, 3);
  assert.equal(result.stdout, 'ok');
});

test('a thrown transient failure is retried too', async () => {
  let calls = 0;
  const result = await retryGitHubOperation(
    async () => {
      if (++calls < 2) throw Object.assign(new Error('Command failed'), { stderr: 'read: connection reset by peer' });
      return 'ok';
    },
    { sleep: noSleep, log: quiet }
  );
  assert.deepEqual([calls, result], [2, 'ok']);
});

test('exhaustion hands back the last attempt in its original shape', async () => {
  let calls = 0;
  const resolved = await retryGitHubOperation(async () => (calls++, failed(BAD_GATEWAY)), { maxAttempts: 4, sleep: noSleep, log: quiet });
  assert.deepEqual([calls, resolved.code], [4, 1], 'a resolved failure stays resolved');

  await assert.rejects(
    retryGitHubOperation(
      async () => {
        throw new Error(BAD_GATEWAY);
      },
      { maxAttempts: 2, sleep: noSleep, log: quiet }
    ),
    /502/,
    'a rejection stays a rejection'
  );
});

test('a non-transient failure is not retried, and the verdict is logged at verbose level', async () => {
  let calls = 0;
  const logs = [];
  const result = await retryGitHubOperation(async () => (calls++, failed('HTTP 404: Not Found')), { sleep: noSleep, log: (message, meta) => logs.push([meta.level, message]) });
  assert.equal(calls, 1);
  assert.equal(result.code, 1);
  assert.deepEqual(
    logs.map(([level]) => level),
    ['verbose']
  );
  assert.match(logs[0][1], /not retrying \[transient=no\] attempt=1\/5 exit=1/);
});

test("GitHub's commit_refs push failure (the #3552 report) is retried", async () => {
  let calls = 0;
  const stderr = 'remote: fatal error in commit_refs\nTo https://github.com/o/r.git\n ! [remote rejected] main -> main (failure)';
  await retryGitHubOperation(async () => (calls++, { code: 1, stdout: '', stderr }), { maxAttempts: 3, sleep: noSleep, log: quiet });
  assert.equal(calls, 3);
});

test('rate limits use their own budget and wait hook', async () => {
  let calls = 0;
  const waits = [];
  const result = await retryGitHubOperation(async () => (++calls < 3 ? failed('API rate limit exceeded for user') : { code: 0, stdout: 'ok', stderr: '' }), {
    maxAttempts: 1,
    sleep: noSleep,
    log: quiet,
    rateLimit: { maxAttempts: 5, isRateLimited: f => /rate limit/.test(f.stderr), wait: async (_, attempt) => waits.push(attempt) },
  });
  assert.deepEqual([calls, waits, result.stdout], [3, [1, 2], 'ok']);
});

test('wrapRunnerWithTransientRetry retries GitHub operations and passes local commands through', async () => {
  const calls = [];
  const run = async (command, args) => (calls.push(`${command} ${args.join(' ')}`), failed(BAD_GATEWAY));
  const wrapped = wrapRunnerWithTransientRetry(run, { maxAttempts: 3, sleep: noSleep, log: quiet });
  await wrapped('git', ['push', 'origin', 'main']);
  await wrapped('git', ['status']);
  await wrapped('npm', ['view', 'x']);
  assert.deepEqual(calls, ['git push origin main', 'git push origin main', 'git push origin main', 'git status', 'npm view x']);
  assert.equal(wrapped.raw, run);
});

test('ghWithRateLimitRetry now retries a resolved failure (the wrapDollarWithGhRetry gap)', async () => {
  let calls = 0;
  const result = await ghWithRateLimitRetry(async () => (++calls < 3 ? failed(BAD_GATEWAY) : { code: 0, stdout: 'ok', stderr: '' }), { transientDelay: 1, log: quiet });
  assert.deepEqual([calls, result.code], [3, 0]);
});

test('wrapRunnerWithGitHubRetry routes gh through the rate-limit aware loop', async () => {
  let calls = 0;
  const run = async () => (++calls < 2 ? failed(BAD_GATEWAY) : { code: 0, stdout: '{}', stderr: '' });
  const wrapped = wrapRunnerWithGitHubRetry(run, { transientDelay: 1, log: quiet });
  const result = await wrapped('gh', ['api', 'user']);
  assert.deepEqual([calls, result.code], [2, 0]);
});

test('the real command-stream $ wrapped by wrapDollarWithGhRetry retries a failing gh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-3552-'));
  const counter = join(dir, 'count');
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho x >> "${counter}"\necho '${BAD_GATEWAY}' >&2\nexit 1\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}:${originalPath}`;
  try {
    const { $: rawDollar } = await import(pathToFileURL(join(repoRoot, 'node_modules', 'command-stream', 'src', '$.mjs')).href);
    const $ = wrapDollarWithGhRetry(rawDollar, { transientMaxAttempts: 3, transientDelay: 1, log: quiet });
    const result = await $({ mirror: false })`gh api repos/o/r`;
    const invocations = existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').length : 0;
    assert.equal(result.code, 1, 'the caller still sees the failed result, not a rejection');
    assert.equal(invocations, 3, 'gh ran once per allowed attempt (it ran once before the fix)');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('wrapping an already wrapped executor returns it unchanged (no nested, multiplied retries)', async () => {
  let calls = 0;
  const run = async () => (calls++, failed(BAD_GATEWAY));
  const once = wrapRunnerWithTransientRetry(run, { maxAttempts: 3, sleep: noSleep, log: quiet });
  assert.equal(wrapRunnerWithTransientRetry(once), once);
  assert.equal(wrapRunnerWithGitHubRetry(once), once);
  await wrapRunnerWithTransientRetry(once, { maxAttempts: 9 })('git', ['push']);
  assert.equal(calls, 3, 'the inner budget applies once, not 3 x 9');

  const dollar = () => ({ code: 0, stdout: '', stderr: '' });
  const wrappedDollar = wrapDollarWithGhRetry(dollar);
  assert.equal(wrapDollarWithGhRetry(wrappedDollar), wrappedDollar);
  assert.equal(wrappedDollar.raw, dollar);
});

test('wrapDollarWithGitRetry is the same universal wrapper: gh is retried too, and re-wrapping never nests', async () => {
  // The tool modules (codex, agent, gemini, opencode, qwen) install this one;
  // the lint rules accept it as a retry wrapper, so it must retry `gh` as well.
  let calls = 0;
  const dollar = () => (calls++, Promise.resolve(failed(BAD_GATEWAY)));
  const $ = wrapDollarWithGitRetry(dollar, { transientMaxAttempts: 3, transientDelay: 1, log: quiet });
  const result = await $`gh api repos/o/r`;
  assert.deepEqual([calls, result.code], [3, 1]);

  assert.equal(wrapDollarWithGhRetry($), $);
  assert.equal(wrapDollarWithGitRetry($), $);
  assert.equal(wrapDollarWithGitRetry(wrapDollarWithGhRetry(dollar)).raw, dollar);
  calls = 0;
  await wrapDollarWithGhRetry($, { transientMaxAttempts: 9 })`gh api repos/o/r`;
  assert.equal(calls, 3, 'the inner budget applies once');

  const local = () => 'process runner';
  assert.equal(wrapDollarWithGitRetry(local)`git status`, 'process runner', 'local commands keep the synchronous ProcessRunner');
});

test('an options call on a stub $ that returns no tag is passed through, so modules wrapping $ at load time still import', () => {
  // tests/test-ready-to-merge-pagination-1645.mjs stubs command-stream with a plain async function;
  // log-upload.lib.mjs runs `$({ mirror: false, capture: true })` at module load.
  const stub = async () => ({ code: 1, stdout: '', stderr: '' });
  for (const wrap of [wrapDollarWithGhRetry, wrapDollarWithGitRetry]) {
    const bound = wrap(stub)({ mirror: false });
    assert.ok(bound instanceof Promise, `${wrap.name} hands back what the stub returned`);
  }
  const tag = () => ({ code: 0, stdout: '', stderr: '' });
  assert.ok(wrapDollarWithGhRetry(() => tag)({ mirror: false }).raw === tag, 'a real bound tag is still wrapped');
});

test('retryGitHubOperationSync applies the same policy synchronously', () => {
  let calls = 0;
  const sleeps = [];
  const result = retryGitHubOperationSync(() => (++calls < 3 ? failed(BAD_GATEWAY) : { code: 0, stdout: 'ok', stderr: '' }), { delayMs: 10, sleep: ms => sleeps.push(ms), log: quiet });
  assert.deepEqual([calls, result.stdout, sleeps], [3, 'ok', [10, 20]]);

  let notTransient = 0;
  assert.throws(
    () =>
      retryGitHubOperationSync(
        () => {
          notTransient++;
          throw new Error('HTTP 404: Not Found');
        },
        { sleep: () => {}, log: quiet }
      ),
    /404/
  );
  assert.equal(notTransient, 1, 'a permanent failure is thrown on the first attempt');
});

test('execSyncWithRetry retries a GitHub command whose stderr shows a transient fault, and runs local commands once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-git-sync-3552-'));
  const counter = join(dir, 'count');
  writeFileSync(join(dir, 'git'), `#!/bin/sh\necho x >> "${counter}"\nif [ "$1" = fetch ]; then echo 'remote: fatal error in commit_refs' >&2; exit 1; fi\nexit 1\n`);
  chmodSync(join(dir, 'git'), 0o755);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  const count = () => (existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').length : 0);

  assert.throws(() => execSyncWithRetry('git fetch origin main', { env, stdio: 'pipe' }, { maxAttempts: 3, sleep: () => {}, log: quiet }), /Command failed/);
  assert.equal(count(), 3, 'the fetch ran once per allowed attempt');

  // `stdio: 'inherit'` is what the release scripts pass; stderr is piped so the
  // classifier can still read the fault (and echoed so the log keeps it).
  assert.throws(() => execSyncWithRetry('git fetch origin main', { env, stdio: 'inherit' }, { maxAttempts: 2, sleep: () => {}, log: quiet }));
  assert.equal(count(), 5, 'the fault is visible to the classifier under stdio: inherit too');

  assert.throws(() => execSyncWithRetry('git status', { env, stdio: 'pipe' }, { maxAttempts: 3, sleep: () => {}, log: quiet }));
  assert.equal(count(), 6, 'a local command is not retried');
});
