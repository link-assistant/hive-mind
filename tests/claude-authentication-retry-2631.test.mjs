/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Match the existing Claude adapter tests: no CLI, API, GitHub or package probe.
globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* () {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};
const { executeClaudeCommand } = await import(process.env.HIVE_TEST_CLAUDE_ADAPTER || '../src/claude.lib.mjs');
const { SUBSCRIPTION_BLOCKED_MARKER } = await import('../src/subscription-error.lib.mjs');
const expired = { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'OAuth token has expired. Please run /login.', error: 'authentication_failed' };

for (const recovered of [true, false]) {
  test(`Claude starts one fresh authentication retry; recovery=${recovered}`, { timeout: 15000 }, async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'hive-auth-2631-'));
    let attempts = 0;
    const logs = [];
    const $ = () => () => {
      const attempt = ++attempts;
      const event = attempt === 2 && recovered ? { type: 'result', subtype: 'success', is_error: false, result: 'Done.' } : expired;
      return {
        pid: 2631 + attempt,
        result: { code: event.is_error ? 1 : 0 },
        kill() {},
        async *stream() {
          yield { type: 'stdout', data: Buffer.from(`${JSON.stringify(event)}\n`) };
        },
      };
    };
    try {
      const result = await executeClaudeCommand({ tempDir: fixture, branchName: 'issue-2631', prompt: 'Solve it.', systemPrompt: 'Solve it.', escapedSystemPrompt: 'Solve it.', argv: { model: 'sonnet', tool: 'claude', uselessToolsDisabled: false }, log: async message => logs.push(String(message)), setLogFile() {}, getLogFile: () => null, formatAligned: (_icon, label, value = '') => `${label} ${value}`, getResourceSnapshot: async () => ({ memory: 'MemAvailable: 1 GB', load: '0.00' }), claudePath: 'claude', $, feedbackLines: [] });
      assert.equal(attempts, 2);
      assert.equal(result.success, recovered);
      if (!recovered) assert.equal(result.subscriptionError.kind, 'login_required');
      const earlyLogs = logs
        .slice(
          0,
          logs.findIndex(line => line.includes('Re-reading shared Claude credentials'))
        )
        .join('\n');
      assert.equal(earlyLogs.includes(SUBSCRIPTION_BLOCKED_MARKER), false);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
}
