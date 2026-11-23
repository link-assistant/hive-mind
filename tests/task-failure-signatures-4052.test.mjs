/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as manager from '../src/hive-manager/index.mjs';
import { summarizeTaskEvidence } from '../src/hive-manager/task/lib/evidence.mjs';
import { buildPrePullRequestFailureActionSection } from '../src/solve.pre-pr-failure-notifier.lib.mjs';

const attempts = JSON.parse(await readFile(new URL('../docs/case-studies/issue-4052/attempts.json', import.meta.url), 'utf8'));
const followUpAttempts = JSON.parse(await readFile(new URL('../docs/case-studies/issue-4136/attempts.json', import.meta.url), 'utf8'));
const evidence = (text, attempt = {}) => summarizeTaskEvidence({ available: true, text }, { exitCode: 1, ...attempt });
const timestamp = '2026-11-20T06:03:29.547Z';

test('classifies all 15 incident attempts from reviewed terminal evidence', () => {
  assert.equal(attempts.length, 15);
  assert.equal(new Set(attempts.map(entry => entry.uuid)).size, 15);
  for (const entry of attempts) {
    assert.equal(evidence(entry.lines.join('\n'), entry).signature, entry.signature, entry.uuid);
  }
});

test('separates the four issue #4136 attempts by their terminal cause', () => {
  assert.equal(followUpAttempts.length, 4);
  assert.equal(new Set(followUpAttempts.map(entry => entry.uuid)).size, 4);
  for (const entry of followUpAttempts) {
    assert.equal(evidence(entry.lines.join('\n'), entry).signature, entry.signature, entry.uuid);
  }
});

test('ignores quoted output and stale verdicts and preserves infrastructure evidence', () => {
  const dirty = 'Error: Repository has uncommitted changes after clone';
  const empty = '❌ Repository setup failed - empty repository';
  assert.equal(evidence(empty, { exitCode: 0 }).signature, undefined);
  assert.equal(evidence(JSON.stringify({ output: empty })).signature, undefined);
  assert.equal(evidence(`    ${empty}\n[${timestamp}] [STDOUT] ${empty}`).signature, undefined);
  assert.equal(evidence(`${empty}\n✅ Repository initialized: now on branch main\n❌ Error occurred`).signature, undefined);
  assert.equal(evidence(`${dirty}\n❌ Error occurred\nError executing command: GitHub API unavailable\n❌ Error occurred`).signature, undefined);
  assert.equal(evidence(`[${timestamp}] [ERROR] ❌ Same CI failure repeated\r\n`).signature, 'same-ci-failure');
  assert.equal(evidence('❌ AI session failed (tool_failure)').signature, 'tool-failure');
  const loopStop = '❌ The AI session failed and `--auto-restart` stopped (tool_failure).';
  const detail = '   Incomplete response returned, reason: max_output_tokens';
  const terminal = '❌ AI session failed (tool_failure)';
  assert.equal(evidence([loopStop, detail, terminal].map(line => `[${timestamp}] [ERROR] ${line}`).join('\n')).signature, 'codex-max-output-tokens');
  assert.equal(evidence(`${detail}\n${terminal}`).signature, 'tool-failure');
  assert.equal(evidence(`${loopStop}\n${detail}`).signature, undefined);
  assert.equal(evidence('❌ Authentication error').signature, 'authentication');
  assert.equal(evidence('❌ AI session failed (tool_failure)', { oomKilled: true }).signature, undefined);
  assert.equal(evidence('Codex exited with exit code 137', { oomKilled: true }).signature, 'codex-oom');
});

test('recognizes dirty clones and exhausted restart budgets in stored Docker tails', () => {
  const dirty = 'Error executing command: Repository has uncommitted changes after clone (M mvnw.cmd)';
  const exhausted = '❌ Auto-restart limit reached after 5 iterations - the blocker was never resolved.';
  assert.equal(evidence(`${dirty}\n❌ Error occurred`).signature, 'checkout-dirty');
  assert.equal(evidence(exhausted).signature, 'auto-restart-limit');
  assert.equal(evidence('❌ Auto-restart limit reached after 1 iteration - the blocker was never resolved.').signature, 'auto-restart-limit');

  const dockerLog = lines => lines.map(line => `2026-11-23T03:05:10.440620932Z ${line}`).join('\n');
  assert.equal(evidence(dockerLog([dirty, '❌ Error occurred', '❌ Error: solve exited with code 1'])).signature, 'checkout-dirty');
  assert.equal(evidence(dockerLog([`[${timestamp}] [ERROR] ${exhausted}`])).signature, 'auto-restart-limit');
  assert.equal(evidence(dockerLog([`[${timestamp}] [STDOUT] ${exhausted}`])).signature, undefined);
  assert.equal(evidence(`${exhausted}\n❌ Error occurred`).signature, undefined);
});

test('groups evidence inside each attempt interval and keeps the existing metadata groups', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-4052-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, 'task.log');
  const older = '❌ Repository setup failed - empty repository\n';
  const middle = 'Exit Code: 1\n';
  await writeFile(logPath, `${older}${middle}❌ No progress between sessions\n`);
  const uuid = '40520000-0000-4000-8000-000000000001';
  const finished = { status: 'executed', exitCode: 1, endTime: timestamp };
  const task = {
    ...finished,
    startTime: timestamp,
    uuid,
    options: { isolated: 'docker' },
    logPath,
    attemptHistory: [
      { ...finished, number: 1, logOffset: 0 },
      { ...finished, number: 2, logOffset: Buffer.byteLength(older) },
    ],
    attempt: { number: 3, logOffset: Buffer.byteLength(older + middle) },
  };

  assert.equal((await manager.collectTaskEvidence([task], { uuid, attempt: 1 })).evidence.signature, 'repository-empty');
  assert.equal((await manager.collectTaskEvidence([task], { uuid, attempt: 2 })).evidence.signature, undefined);
  assert.equal((await manager.collectTaskEvidence([task], { uuid })).evidence.signature, 'no-progress');
  const existing = manager.groupTaskFailures([task]);
  assert.deepEqual(
    existing.groups.map(({ count }) => count),
    [3]
  );

  const classified = await manager.groupTaskFailuresBySignature([task]);
  assert.deepEqual(
    classified.groups.map(({ signature, count }) => [signature, count]),
    [
      ['repository-empty', 1],
      [undefined, 1],
      ['no-progress', 1],
    ]
  );

  await writeFile(join(directory, 'records.json'), JSON.stringify({ executions: [task] }));
  await writeFile(join(directory, '$'), '#!/bin/sh\ncat records.json\n', { mode: 0o700 });
  const report = fileURLToPath(new URL('../src/hive-manager/task/report.mjs', import.meta.url));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [report, ...args], { cwd: directory, env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(run('--group', '--by-signature'), classified);
  assert.match(run('--incident', uuid, '--attempt', '1').body, /Log signature `repository-empty`/);
  assert.match(run('--incident', uuid).body, /Log signature `no-progress`/);
});

test('empty repositories require an initial commit in both solver paths', () => {
  for (const reason of ['Repository setup failed - empty repository', 'Empty repository auto-initialization failed', 'Empty repository detected - use --auto-init-repository to initialize']) {
    const help = buildPrePullRequestFailureActionSection(reason);
    assert.match(help, /first commit/);
    assert.match(help, /write access/);
    assert.doesNotMatch(help, /delete|rename|archive|--fork/);
  }
  const help = buildPrePullRequestFailureActionSection('Failed to fetch after empty repository initialization');
  assert.doesNotMatch(help, /first commit/);
});
