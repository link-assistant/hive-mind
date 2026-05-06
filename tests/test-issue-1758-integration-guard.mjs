#!/usr/bin/env node
/**
 * Regression tests for tests/integration-guard.mjs (issue #1758).
 *
 * Verifies the guard:
 *   1. Exits 0 with a skip line when HIVE_MIND_RUN_INTEGRATION is unset.
 *   2. Lets the test continue when HIVE_MIND_RUN_INTEGRATION=1.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1758
 * @hive-mind-test-suite default
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const guardPath = join(__dirname, 'integration-guard.mjs');

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

const dir = mkdtempSync(join(tmpdir(), 'hive-mind-guard-'));
const fakeTest = join(dir, 'fake-integration.mjs');
writeFileSync(
  fakeTest,
  `import { skipUnlessIntegration } from '${guardPath.replace(/\\/g, '\\\\')}';
skipUnlessIntegration(import.meta.url);
console.log('REACHED');
process.exit(42); // distinguishable exit code if guard fails to skip
`
);

console.log('Issue #1758 — integration guard');
console.log('='.repeat(70));

try {
  // 1. Default: skip
  {
    const env = { ...process.env };
    delete env.HIVE_MIND_RUN_INTEGRATION;
    const result = spawnSync(process.execPath, [fakeTest], { encoding: 'utf-8', env });
    assert(result.status === 0, 'guard exits 0 when HIVE_MIND_RUN_INTEGRATION is unset');
    assert(result.stdout.includes('Skipping'), 'skip line printed');
    assert(!result.stdout.includes('REACHED'), 'guarded body did not execute');
  }

  // 2. Opt-in: continue
  {
    const result = spawnSync(process.execPath, [fakeTest], {
      encoding: 'utf-8',
      env: { ...process.env, HIVE_MIND_RUN_INTEGRATION: '1' },
    });
    assert(result.status === 42, 'guard does not skip when HIVE_MIND_RUN_INTEGRATION=1');
    assert(result.stdout.includes('REACHED'), 'guarded body executed');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('='.repeat(70));
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
