// Reproduces link-assistant/calculator#247 (issue #3174) against hive-mind's own modules.
// Usage: node experiments/issue-3174-repro.mjs <path to hive-mind checkout>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = file => pathToFileURL(resolve(process.argv[2] || '.', 'src', file)).href;
const { repairRequiredIssueLinks } = await import(src('pr-issue-link-repair.lib.mjs'));

// #1 asks for a plan; #2 and #3 are the implementation issues the session
// created and attached as native sub-issues. #4 is a sub-issue in another
// repository (issue #3276).
const issues = { 1: 'Analyse the problem and create one issue per part of the work.', 2: 'Implement part A.', 3: 'Implement part B.' };
const subIssues = { 1: [2, 3], 2: [], 3: [] };
let prBody = 'Closes #1\n\nThis PR only plans the work: #2 and #3 stay open.';

const ok = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const run = async args => {
  const [command, target] = args;
  if (command === 'api' && target === 'repos/other/project/issues/4/sub_issues') return ok([[]]);
  if (command === 'api' && target === 'repos/other/project/issues/4') return ok({ number: 4, body: 'Foreign work.' });
  if (command === 'api' && /issues\/\d+\/sub_issues$/.test(target)) {
    const number = Number(target.split('/').at(-2));
    const local = subIssues[number].map(n => ({ number: n, repository_url: 'https://api.github.com/repos/o/r' }));
    return ok([number === 1 ? [...local, { number: 4, repository_url: 'https://api.github.com/repos/other/project' }] : local]);
  }
  if (command === 'api' && /issues\/\d+$/.test(target)) {
    const number = Number(target.split('/').at(-1));
    return ok({ number, body: issues[number] });
  }
  if (command === 'api' && /pulls\/10$/.test(target)) return ok({ number: 10, body: prBody });
  if (command === 'pr' && target === 'edit') {
    prBody = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
    return { code: 0, stdout: '', stderr: '' };
  }
  throw new Error(`unexpected gh ${args.join(' ')}`);
};

const repair = () => repairRequiredIssueLinks({ owner: 'o', repo: 'r', issueNumber: 1, prNumber: 10, run, logger: async m => console.log('  log:', m) });

console.log('1. Session ends; the finally-block repair runs:');
await repair();
console.log(JSON.stringify(prBody));
console.log('2. A description an older repair already extended:');
prBody = 'Closes #1\n\nThis PR only plans the work: #2 and #3 stay open.\n\n---\n\nFixes #2\nFixes #3\nFixes other/project#4';
await repair();
console.log(JSON.stringify(prBody));
