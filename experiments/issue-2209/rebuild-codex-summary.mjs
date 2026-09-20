// Reassemble the codex replay summary from its driver log. The driver writes
// logs/replay/replay-summary.json in place, so the codex file was overwritten by
// the two later runs; every field below is parsed out of the committed log.
import fs from 'node:fs';
const log = fs.readFileSync('docs/case-studies/issue-2209/data/replay/driver-codex.log', 'utf8');
const blocks = [...log.matchAll(/^\{$[\s\S]*?^\}$/gm)].map(m => JSON.parse(m[0]));
const [update, task, outcome] = blocks;
const summary = { tasks: [{ ...task, exitCode: outcome.exitCode, logFile: 'docs/case-studies/issue-2209/data/replay/codex-rust.log.gz', remote: outcome.remote }], update };
fs.writeFileSync('docs/case-studies/issue-2209/data/replay/replay-summary-codex.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
