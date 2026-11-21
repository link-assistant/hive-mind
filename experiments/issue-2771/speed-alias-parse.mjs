// Issue #2771 / PR #2772 review: which --speed spellings does the solve CLI accept?
// Usage: node experiments/issue-2771/speed-alias-parse.mjs [values...]
import { parseArguments } from '../../src/solve.config.lib.mjs';
import { normalizeSpeed } from '../../src/pricing-tier.lib.mjs';

const values = process.argv.slice(2).length ? process.argv.slice(2) : ['standard', 'flex', 'batch', 'slow', 'priority', 'fast', 'ultrafast'];
for (const value of values) {
  let parsed;
  try {
    const argv = await parseArguments(undefined, () => ['https://github.com/o/r/issues/1', '--speed', value]);
    parsed = argv.speed;
  } catch (error) {
    parsed = `rejected (${String(error.message).split('\n')[0].slice(0, 80)})`;
  }
  let normalized;
  try {
    normalized = normalizeSpeed(parsed);
  } catch (error) {
    normalized = `rejected`;
  }
  console.log(`--speed ${value.padEnd(10)} argv.speed=${String(parsed).padEnd(12)} normalized=${normalized}`);
}
