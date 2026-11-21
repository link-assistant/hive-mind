#!/usr/bin/env node
// Issue #3684: replays `/solve <repository-url>` several times (as kill recovery
// does) against a stateful fake GitHub and counts the combined issues created.
// Uses only APIs that existed before the fix, so it runs on both versions:
//   before the fix: 3 runs -> 3 combined issues (like #181, #183, #185)
//   after the fix:  3 runs -> 1 combined issue, every issue attached once
import { readFile } from 'node:fs/promises';
import { resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';

const URL_ = 'https://github.com/link-foundation/browser-commander';
const issues = new Map();
for (const n of [179, 180]) issues.set(n, JSON.parse(await readFile(new URL(`../docs/case-studies/issue-3684/data/issue-${n}.json`, import.meta.url), 'utf8')));
const parentOf = new Map();
let next = 181;
let creates = 0;
let attachCalls = 0;
const ok = v => ({ code: 0, stdout: typeof v === 'string' ? v : JSON.stringify(v), stderr: '' });
const run = async (_cmd, args) => {
  const ep = String(args[1] || '');
  if (args[0] === 'api' && ep.includes('/issues?state=open')) return ok([...issues.values()]);
  if (args[0] === 'issue' && args[1] === 'create') {
    const number = next++;
    creates++;
    const body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
    issues.set(number, { number, id: number * 1000, title: args[args.indexOf('--title') + 1], body, html_url: `${URL_}/issues/${number}`, created_at: new Date(Date.UTC(2026, 9, 21, 15, number - 170)).toISOString(), user: { login: 'konard', type: 'User' }, labels: [] });
    return ok(`${URL_}/issues/${number}\n`);
  }
  if (args[0] === 'issue' && args[1] === 'edit') {
    const issue = issues.get(Number(args[2]));
    issue.body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
    return ok('');
  }
  const post = args.find(a => /issues\/\d+\/sub_issues$/.test(String(a)));
  if (args.includes('POST') && post) {
    attachCalls++;
    const parent = Number(post.match(/issues\/(\d+)/)[1]);
    const child = [...issues.values()].find(i => i.id === Number(String(args.at(-1)).split('=')[1]));
    if (parentOf.has(child.number) && !args.includes('replace_parent=true')) return { code: 1, stdout: '', stderr: 'HTTP 422: Sub issue may only have one parent' };
    parentOf.set(child.number, parent);
    return ok('{}');
  }
  const list = ep.match(/issues\/(\d+)\/sub_issues/);
  if (args[0] === 'api' && list) return ok([[...parentOf].filter(([, p]) => p === Number(list[1])).map(([c]) => issues.get(c))]);
  const parent = ep.match(/issues\/(\d+)\/parent$/);
  if (args[0] === 'api' && parent) return ok(parentOf.has(Number(parent[1])) ? issues.get(parentOf.get(Number(parent[1]))) : null);
  return ok('{}');
};

for (let attempt = 1; attempt <= 3; attempt++) {
  const result = await resolveRepositoryModeTarget({ url: URL_, run, attachOptions: { delayMs: 0 } });
  console.log(`run ${attempt}: ${result.issueUrl}${result.reused ? ' (reused)' : ''}`);
}
console.log(`combined issues created: ${creates}; sub-issue POST calls: ${attachCalls}`);
console.log(`parents: ${[...parentOf].map(([c, p]) => `#${c}->#${p}`).join(', ')}`);
process.exitCode = creates === 1 ? 0 : 1;
