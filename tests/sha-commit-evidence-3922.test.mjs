#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3922: the uploaded solve log printed `https://github.com/<owner>/<repo>/commit/781…75a`
 * instead of the merge commit SHA. `git rev-parse HEAD` was mirrored into the log as a bare
 * `[STDOUT] <sha>` line, the sanitizer treated that 40-hex line as a possible token, and its
 * second pass then replaced every occurrence — including the commit links that prove the value
 * is a public commit id.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sanitizeLogContent, hexHasCommitEvidence } from '../src/token-sanitization.lib.mjs';

const sha = '7819203e20e6098845848bfe15724ead6ac6f75a';
const bareLine = `[2026-10-31T17:52:31.110Z] [STDOUT] ${sha}\n`;
const commitLink = `/merge: PR #414 HEAD https://github.com/G-Ivan-A/mango_ba_prompts/commit/${sha} has no check-runs\n`;

test('a SHA printed on its own line survives when the log also links to it as a commit', async () => {
  const out = await sanitizeLogContent(bareLine + commitLink);
  assert.ok(out.includes(`/commit/${sha}`), out);
  assert.ok(!out.includes('781…75a'), out);
});

test('a SHA in a headRefOid JSON field or after git rev-parse is commit evidence', async () => {
  assert.ok((await sanitizeLogContent(`{"headRefOid":"${sha}","mergeable":"MERGEABLE"}\n`)).includes(sha));
  assert.equal(hexHasCommitEvidence(`$ git rev-parse HEAD\n${sha}\n`, sha), true);
  assert.equal(hexHasCommitEvidence(`"head_sha": "${sha}"`, sha), true);
});

test('a bare 40-hex value without any commit evidence is still masked', async () => {
  const out = await sanitizeLogContent(bareLine);
  assert.ok(!out.includes(sha), 'unknown 40-hex strings may be tokens and stay masked');
  assert.equal(hexHasCommitEvidence(bareLine, sha), false);
  assert.equal(hexHasCommitEvidence(`token=${sha}\nsee /commits/abc`, sha), false, 'evidence must precede this exact value');
});

test('session-progress git probes do not mirror their stdout into the log', () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'session-progress.lib.mjs'), 'utf8');
  assert.match(source, /command\(\{ cwd: tempDir, mirror: false \}\)`git status --porcelain 2>&1`/);
  assert.match(source, /command\(\{ cwd: tempDir, mirror: false \}\)`git rev-parse HEAD 2>&1`/);
});
