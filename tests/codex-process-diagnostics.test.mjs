/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildCodexMemoryBudgetPrompt, findCodexStderrError, normalizeCodexExit } from '../src/codex.process-exit.lib.mjs';
import { CODEX_LAST_MESSAGE_MAX_BYTES, readCodexLastMessage } from '../src/codex.last-message.lib.mjs';

test('budget guidance requires a finite positive limit and tolerates missing current use', () => {
  for (const snapshot of [null, {}, { limitBytes: null }, { limitBytes: Infinity }, { limitBytes: 0 }]) assert.equal(buildCodexMemoryBudgetPrompt(snapshot), '');
  const prompt = buildCodexMemoryBudgetPrompt({ limitBytes: 1024 ** 3 });
  assert.match(prompt, /1\.00 GiB/);
  assert.doesNotMatch(prompt, /headroom|NaN/);
  assert.match(buildCodexMemoryBudgetPrompt({ limitBytes: 1024, currentBytes: 2048 }), /headroom is 0\.00 GiB/);
});

test('signal normalization preserves normal failures and interruptions', () => {
  assert.deepEqual(normalizeCodexExit({ code: 127 }), { exitCode: 127, signal: null });
  assert.deepEqual(normalizeCodexExit({ code: 130 }), { exitCode: 130, signal: 'SIGINT' });
  assert.deepEqual(normalizeCodexExit({ code: null, signal: 'SIGTERM' }), { exitCode: 143, signal: 'SIGTERM' });
  assert.equal(normalizeCodexExit({ code: null }).exitCode, 1);
});

test('plain diagnostics are bounded and include missing executable errors', () => {
  assert.equal(findCodexStderrError('sh: 1: codex: not found'), 'sh: 1: codex: not found');
  assert.equal(findCodexStderrError(`Error: ${'x'.repeat(2048)}`).length, 1024);
  assert.equal(findCodexStderrError('normal progress\n{"error":"echo"}', 'Error: actual failure'), 'Error: actual failure');
});

test('extracted final-message reader retains missing-file handling and the 1 MiB cap', { timeout: 10000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-message-test-'));
  const file = path.join(tempDir, 'last.txt');
  try {
    assert.equal((await readCodexLastMessage(file)).readError.code, 'ENOENT');
    await writeFile(file, '  Done.\n');
    assert.deepEqual(await readCodexLastMessage(file), { lastMessage: 'Done.', readError: null });
    await writeFile(file, 'x'.repeat(CODEX_LAST_MESSAGE_MAX_BYTES + 1024));
    const { lastMessage, readError } = await readCodexLastMessage(file);
    assert.equal(readError, null);
    assert.match(lastMessage, /last message truncated/);
    assert.ok(lastMessage.length < CODEX_LAST_MESSAGE_MAX_BYTES + 512);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
