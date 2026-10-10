// Captured calculator data, served to the production batch lookup and relation gate.
import { readFileSync } from 'node:fs';

const root = 'https://github.com/link-assistant/calculator';
const [captured] = JSON.parse(readFileSync(new URL('../../docs/case-studies/issue-2685/data/calculator-open-prs.json', import.meta.url)));
const parentPr = { ...captured, state: 'OPEN', url: captured.html_url, headRefName: captured.head.ref };
const snapshot = JSON.parse(readFileSync(new URL('../../docs/case-studies/issue-2615/data/calculator-open-issues-relations.json', import.meta.url)));
const ref = item => item && { url: `${root}/issues/${item.number}`, state: item.state };
const connection = items => ({ ...items, nodes: items.nodes.map(ref) });
const nodes = new Map(snapshot.data.repository.issues.nodes.map(item => [item.number, { ...ref(item), parent: ref(item.parent), subIssues: connection(item.subIssues), blockedBy: connection(item.blockedBy), blocking: connection(item.blocking), timelineItems: { nodes: [{ source: parentPr }] } }]));

export async function answerGh(command) {
  if (command.includes('query GetPullRequestsForIssues')) {
    if (process.env.HIVE_FIXTURE_SCENARIO === 'parent-prs-rest') throw new Error('Fixture GraphQL PR query unavailable');
    const repository = {};
    for (const [, alias, number] of command.matchAll(/(issue\d+): issue\(number: (\d+)\)/g)) repository[alias] = nodes.get(Number(number));
    return { stdout: JSON.stringify({ data: { repository } }) };
  }
  if (command.includes('query HiveIssueRelations')) {
    const r0 = {};
    for (const [, alias, number] of command.matchAll(/(i\d+): issue\(number: (\d+)\)/g)) r0[alias] = nodes.get(Number(number));
    return { stdout: JSON.stringify({ data: { r0 } }) };
  }
  if (command.includes('/timeline')) {
    if (command.includes('--slurp') && command.includes('--jq')) throw new Error('the --slurp option is not supported with --jq');
    const event = { event: 'cross-referenced', source: { issue: { ...captured, pull_request: { merged_at: null } } } };
    return { stdout: JSON.stringify([[{ event: 'labeled' }], [event]]) };
  }
  const parent = command.match(/issues\/(\d+)\/parent/);
  if (parent) {
    const node = nodes.get(Number(parent[1]));
    if (!node?.parent) throw new Error('HTTP 404: No parent');
    return { stdout: JSON.stringify({ html_url: node.parent.url }) };
  }
  if (command.includes('/pulls/228')) return { stdout: JSON.stringify(captured) };
  throw new Error(`Unexpected GitHub command: ${command}`);
}
