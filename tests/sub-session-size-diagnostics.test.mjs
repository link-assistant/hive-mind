/**
 * @hive-mind-test-suite default
 * CodeQL alert 228: assertion diagnostics must not print inherited environment
 * values, even when the opt-in integration suite fails.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('sub-session assertion failures retain test names without environment values', { timeout: 15000 }, () => {
  const home = mkdtempSync(join(tmpdir(), 'hive-sub-session-diagnostics-'));
  const sentinels = {
    CLAUDE_CODE_DISABLE_1M_CONTEXT: 'synthetic-inherited-disable-value',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'synthetic-inherited-window-value',
    CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: 'synthetic-inherited-percent-value',
  };
  try {
    // Resolve installed dependencies locally; this probe needs no bootstrap
    // download and inherits no operator configuration or credentials.
    const entry = new URL('./test-issue-1706-sub-session-size.mjs', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', String.raw`globalThis.use = name => import(name.replace(/@\d[^/]*$/, '')); await import(${JSON.stringify(entry)});`], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { HOME: home, ...sentinels },
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 128 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1, 'the synthetic inherited values must cause assertion failures');
    const output = child.stdout + child.stderr;
    for (const name of ['no DISABLE_1M_CONTEXT when disabled=false', 'no AUTO_COMPACT_WINDOW when sub-session-size=default', 'no PCT_OVERRIDE when sub-session-size=default']) {
      assert.ok(output.includes(`❌ getClaudeEnv: ${name}`), 'the failing assertion name must remain available');
    }
    for (const value of Object.values(sentinels)) {
      assert.equal(output.includes(value), false, 'assertion diagnostics must omit inherited environment values');
    }
    assert.match(output, /Results: \d+ passed, [1-9]\d* failed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
