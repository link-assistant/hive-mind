// Repeat the existing smoke test's exact help command and five-second bound.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const hive = fileURLToPath(new URL('../../src/hive.mjs', import.meta.url));
for (let attempt = 1; attempt <= 3; attempt++) {
  const start = performance.now();
  const result = spawnSync(hive, ['--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 });
  console.log(JSON.stringify({ attempt, elapsedMs: Math.round(performance.now() - start), exit: result.status, signal: result.signal, error: result.error?.code || null, stdoutBytes: Buffer.byteLength(result.stdout || ''), stderrBytes: Buffer.byteLength(result.stderr || ''), hasUsage: result.stderr?.includes('Usage:') || false }));
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.ok(result.stderr.includes('Usage:'));
}
