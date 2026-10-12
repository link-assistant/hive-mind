#!/usr/bin/env node
// Issue #3001: command-stream 2.3.0 (freshness-gate bump) still resolves with { code }
// on a non-zero exit, and stdout is a truthy object even when empty.
// Usage: node command-stream-2.3.0-nonzero-exit.mjs <path to command-stream/src/$.mjs>
const { $ } = await import(process.argv[2]);
for (const cmd of ['true', 'false', 'echo oops >&2; exit 3']) {
  try {
    const r = await $({ mirror: false })`sh -c ${cmd}`;
    console.log(JSON.stringify(cmd), 'resolved code=', r.code, 'stderr=', JSON.stringify(r.stderr?.toString()), 'stdoutTruthy=', !!r.stdout, 'keys=', Object.keys(r).join(','));
  } catch (e) {
    console.log(JSON.stringify(cmd), 'THREW', e.message);
  }
}
