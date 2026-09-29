#!/usr/bin/env node
/**
 * Regression tests for the command-stream 1.x result shape (PR #2297).
 *
 * The dependency-freshness gate (issue #2264) moved the pinned command-stream
 * from 0.x to 1.x. In 1.x a completed result's `stdout`/`stderr` are
 * `CapturedReadable` streams instead of strings: they still stringify, but an
 * EMPTY stream is truthy, so `result.stderr || fallback` never falls back and
 * `!result.stdout` never detects empty output. Call sites read the text
 * explicitly with `result.stdout?.toString()`, which works for both shapes.
 *
 * Runs the pinned command-stream for real, so the tests fail if a future
 * upgrade changes the shape again.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
import { postKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { describeChildExit } from '../src/child-exit.lib.mjs';

const use = await ensureUseM();
const { $ } = await use('command-stream');
const $quiet = $({ mirror: false });
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.stack || error.message}`);
    failed++;
  }
};

const noopFs = { writeFile: async () => {}, unlink: async () => {} };

await test('pinned command-stream returns truthy stream objects even for empty output', async () => {
  const result = await $quiet`true`;
  assert.equal(result.code, 0);
  assert.equal(typeof result.stdout, 'object', 'stdout is a stream object, not a string');
  assert.equal(Boolean(result.stdout), true, 'an empty stream is still truthy');
  assert.equal(result.stdout?.toString(), '');
  assert.equal(result.stdout?.toString() || 'fallback', 'fallback');
});

await test('stream results still stringify and expose common string methods', async () => {
  const result = await $quiet`echo hello`;
  assert.equal(`${result.stdout}`, 'hello\n');
  assert.equal(result.stdout.trim(), 'hello');
  assert.equal(result.stdout?.toString().trim(), 'hello');
  assert.equal(JSON.parse(JSON.stringify({ out: result.stdout })).out, 'hello\n');
});

await test('postKillRecoveryNotice falls back to the exit description when gh prints nothing', async () => {
  const silentFailure = await $quiet`sh -c 'exit 4'`;
  assert.equal(silentFailure.code, 4);
  const outcome = await postKillRecoveryNotice({ pullRequestUrl: 'https://github.com/o/r/pull/1', body: 'notice', runCommand: async () => silentFailure, ...noopFs });
  assert.equal(outcome.posted, false);
  assert.equal(outcome.error, describeChildExit({ command: 'gh pr comment', code: 4 }));
});

await test('postKillRecoveryNotice uses stdout when stderr is empty', async () => {
  const stdoutOnly = await $quiet`sh -c 'echo "GraphQL: Resource not accessible"; exit 1'`;
  const outcome = await postKillRecoveryNotice({ pullRequestUrl: 'https://github.com/o/r/pull/1', body: 'notice', runCommand: async () => stdoutOnly, ...noopFs });
  assert.equal(outcome.error, 'GraphQL: Resource not accessible');
});

await test('postKillRecoveryNotice returns null url when gh succeeds silently', async () => {
  const silentSuccess = await $quiet`true`;
  const outcome = await postKillRecoveryNotice({ pullRequestUrl: 'https://github.com/o/r/pull/1', body: 'notice', runCommand: async () => silentSuccess, ...noopFs });
  assert.deepEqual(outcome, { posted: true, url: null, error: null });
});

// Static guard: catch new truthiness checks on raw command results. Values
// passed to helpers are fine (they coerce with String()/toString()), and
// thrown error objects still carry plain strings.
await test('src/ has no truthiness checks on raw command-stream stdout/stderr', () => {
  const errorOwner = /^(?:err|error|e|execError|catchErr|process|child|proc|childProcess|subprocess|ps|spawned|cp)$/i;
  const member = /(!\s*)?\b([A-Za-z_$][\w$]*)(?:\?\.|\.)(stdout|stderr)\b(?!\s*(?:\?\.|\.|\[|\())(\s*(?:\|\||&&|\?(?![.?])))?/g;
  const hits = [];
  for (const name of readdirSync(join(repoRoot, 'src'), { recursive: true })) {
    if (!/\.m?js$/.test(name)) continue;
    readFileSync(join(repoRoot, 'src', name), 'utf8')
      .split('\n')
      .forEach((text, index) => {
        if (/^\s*(\/\/|\*)/.test(text)) return;
        for (const match of text.matchAll(member)) {
          if ((match[1] || match[4]) && !errorOwner.test(match[2])) hits.push(`src/${name}:${index + 1}: ${text.trim()}`);
        }
      });
  }
  assert.deepEqual(hits, [], 'use `result.stdout?.toString()` instead of `result.stdout` in boolean/fallback contexts');
});

console.log(`\n📊 ${passed + failed} test(s): ✅ ${passed} passed, ❌ ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
