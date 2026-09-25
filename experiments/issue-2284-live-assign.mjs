#!/usr/bin/env node
// Live check for issue #2284: assign the current `gh` user to one issue using
// the exact code path repository mode uses.
// Usage: node experiments/issue-2284-live-assign.mjs <owner> <repo> <issue-number>
import { assignIssuesToCurrentUser } from '../src/solve.repository-mode.run.lib.mjs';

const [owner, repo, number] = process.argv.slice(2);
if (!owner || !repo || !number) {
  console.error('Usage: node experiments/issue-2284-live-assign.mjs <owner> <repo> <issue-number>');
  process.exit(2);
}
const result = await assignIssuesToCurrentUser({ repository: { owner, repo }, issues: [{ number: Number(number) }], log: async message => console.log(message) });
console.log(JSON.stringify(result, null, 2));
