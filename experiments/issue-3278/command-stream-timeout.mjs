// Issue #3278: does command-stream honour a `timeout` option, or only an AbortSignal?
// Usage: node experiments/issue-3278/command-stream-timeout.mjs
import { $ } from 'command-stream';

const time = async (label, run) => {
  const started = Date.now();
  try {
    const result = await run();
    console.log(`${label}: finished after ${Date.now() - started} ms, code ${result.code}`);
  } catch (error) {
    console.log(`${label}: threw after ${Date.now() - started} ms: ${error?.message || error}`);
  }
};

await time('$({ timeout: 500 }) sleep 3', () => $({ mirror: false, timeout: 500 })`sleep 3`);
await time('$({ signal: AbortSignal.timeout(500) }) sleep 3', () => $({ mirror: false, signal: AbortSignal.timeout(500) })`sleep 3`);
process.exit(0);
