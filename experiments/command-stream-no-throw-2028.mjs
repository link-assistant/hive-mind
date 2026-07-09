#!/usr/bin/env node
/**
 * Experiment for issue #2028: does command-stream's `$` throw on a non-zero
 * exit code?
 *
 * This is the behaviour that let scripts/publish-to-npm.mjs swallow a failed
 * `npm run changeset:publish` and report a false-positive release. The publish
 * script used `try { await $\`...\` } catch { ... }`, expecting a throw that
 * never happens.
 *
 * Run: node experiments/command-stream-no-throw-2028.mjs
 * Expected output: every case prints "NO THROW" with the real non-zero code,
 * proving the catch block was dead code.
 */
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { $ } = await use('command-stream');

console.log('--- default `await $` on a failing command (exit 3) ---');
try {
  const r = await $`bash -c "echo out; echo err 1>&2; exit 3"`;
  console.log('NO THROW. code =', r.code, 'stdout =', JSON.stringify(r.stdout), 'stderr =', JSON.stringify(r.stderr));
} catch (e) {
  console.log('THREW:', e.message, 'code =', e.code);
}

console.log('--- `await $\\`false\\`` ---');
try {
  const r = await $`false`;
  console.log('NO THROW. code =', r.code);
} catch (e) {
  console.log('THREW:', e.message);
}

console.log('--- `.run({ capture: true })` on exit 7 ---');
try {
  const r = await $`bash -c "exit 7"`.run({ capture: true });
  console.log('NO THROW. code =', r.code);
} catch (e) {
  console.log('THREW:', e.message);
}
