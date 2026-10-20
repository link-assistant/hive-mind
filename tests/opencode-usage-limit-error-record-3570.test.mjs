/**
 * @hive-mind-test-suite default
 * Issue #3570 (OpenCode side): `opencode run --format json` reports a failed
 * step as a `{"type":"error"}` record and exits 1. A usage limit in that record
 * must be found even when it is not the last stdout chunk.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};
const { executeOpenCodeCommand } = await import('../src/opencode.lib.mjs');

const LIMIT = "You've hit your weekly limit · resets 11am (UTC)";
const errorRecord = message => JSON.stringify({ type: 'error', timestamp: 1792437517000, sessionID: 'ses_3570', error: { name: 'APIError', data: { message } } });
const trailing = JSON.stringify({ type: 'step_finish', timestamp: 1792437518000, sessionID: 'ses_3570', part: { type: 'step-finish', reason: 'error' } });

async function replay(chunks, code = 1) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3570-opencode-'));
  const logs = [];
  const fakeDollar = () => () => ({
    async *stream() {
      for (const chunk of chunks) yield { type: 'stdout', data: Buffer.from(`${chunk}\n`) };
      yield { type: 'exit', code };
    },
  });
  try {
    const result = await executeOpenCodeCommand({
      tempDir,
      branchName: 'issue-3570-test',
      prompt: 'Run the tests.',
      systemPrompt: 'Solve the issue.',
      argv: { model: 'grok', verbose: true },
      log: async (message, options) => logs.push({ message: String(message), options }),
      formatAligned: (_icon, label, value = '') => `${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  9.4 GB available', load: '0.00' }),
      opencodePath: 'opencode',
      $: fakeDollar,
      waitForRetryDelay: async () => {},
    });
    return { result, text: logs.map(entry => entry.message).join('\n') };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('a usage limit in an error record followed by another chunk is a usage limit', { timeout: 10000 }, async () => {
  const { result, text } = await replay([errorRecord(LIMIT), trailing]);
  assert.equal(result.success, false);
  assert.equal(result.limitReached, true);
  assert.equal(result.limitResetTime, '11:00 AM');
  assert.equal(result.limitTimezone, 'UTC');
  assert.match(text, /✔ usage-limit source error record: usage-limit text/);
  assert.doesNotMatch(text, /OpenCode command failed with exit code 1/);
});

test('a non-limit error record stays a plain failure', { timeout: 10000 }, async () => {
  const { result, text } = await replay([errorRecord('Invalid model id'), trailing]);
  assert.equal(result.limitReached, false);
  assert.equal(result.limitTimezone, null);
  assert.match(text, /OpenCode command failed with exit code 1/);
});
