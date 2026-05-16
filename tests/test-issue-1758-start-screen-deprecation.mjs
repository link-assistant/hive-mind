#!/usr/bin/env node
/**
 * Regression test for the start-screen deprecation banner introduced in #1758.
 *
 * Verifies:
 *   1. `./src/start-screen.mjs --help` writes the deprecation banner to stderr.
 *   2. The banner is suppressed when HIVE_MIND_SUPPRESS_DEPRECATIONS=1.
 *   3. `executeStartScreen()` from telegram-command-execution.lib.mjs prints
 *      its own banner once per process.
 *
 * Uses --help / no-arg invocations to avoid touching real screen sessions.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1758
 * @hive-mind-test-suite default
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const startScreenPath = join(repoRoot, 'src', 'start-screen.mjs');

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

function runStartScreen(args, env = {}) {
  return spawnSync(process.execPath, [startScreenPath, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

console.log('Issue #1758 — start-screen deprecation banner');
console.log('='.repeat(70));

// 1. CLI banner on --help
{
  const result = runStartScreen(['--help']);
  assert(result.status === 0, 'start-screen --help exits 0');
  assert(result.stderr.includes('start-screen is deprecated'), 'start-screen --help prints deprecation banner to stderr');
  assert(result.stderr.includes('--isolated screen'), 'banner mentions the recommended --isolated screen flow');
  assert(result.stderr.includes('HIVE_MIND_SUPPRESS_DEPRECATIONS'), 'banner mentions the suppression env var');
  assert(result.stdout.includes('Usage:'), 'help text is still printed to stdout');
}

// 2. Suppression via env var
{
  const result = runStartScreen(['--help'], { HIVE_MIND_SUPPRESS_DEPRECATIONS: '1' });
  assert(result.status === 0, 'start-screen --help exits 0 under HIVE_MIND_SUPPRESS_DEPRECATIONS=1');
  assert(!result.stderr.includes('start-screen is deprecated'), 'banner is suppressed when HIVE_MIND_SUPPRESS_DEPRECATIONS=1');
  assert(result.stdout.includes('Usage:'), 'help text still prints under suppression');
}

// 3. Banner on missing-args path too (covers code branches other than --help)
{
  const result = runStartScreen([]);
  assert(result.status === 1, 'start-screen with no args exits 1');
  assert(result.stderr.includes('start-screen is deprecated'), 'banner appears on missing-args invocation');
}

// 4. Library-level deprecation warning
{
  const probe = `
    import { executeStartScreen } from '${join(repoRoot, 'src', 'telegram-command-execution.lib.mjs').replace(/\\/g, '\\\\')}';
    // Force the which-lookup to fail to keep the test offline-safe.
    process.env.PATH = '/nonexistent';
    await executeStartScreen('solve', ['https://example.com'], { verbose: false });
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf-8',
    env: { ...process.env },
  });
  assert(result.stderr.includes('executeStartScreen is deprecated'), 'executeStartScreen() prints library-level deprecation warning');

  const suppressed = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf-8',
    env: { ...process.env, HIVE_MIND_SUPPRESS_DEPRECATIONS: '1' },
  });
  assert(!suppressed.stderr.includes('executeStartScreen is deprecated'), 'library deprecation suppressed when env var set');
}

console.log('='.repeat(70));
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
