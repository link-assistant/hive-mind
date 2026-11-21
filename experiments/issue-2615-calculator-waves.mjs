#!/usr/bin/env node
// Issue #2615: simulate hive on the calculator snapshot assuming every started issue is merged
// before the next polling iteration, and print the waves of parallel work.
import { readFileSync } from 'node:fs';
import { normalizeIssueRelations, planIssueQueue } from '../src/hive.issue-relations.lib.mjs';

const snapshot = JSON.parse(readFileSync(new URL('../docs/case-studies/issue-2615/data/calculator-open-issues-relations.json', import.meta.url), 'utf8'));
const base = 'https://github.com/link-assistant/calculator/issues/';
const closed = new Set();
const build = () => {
  const ref = item => (item ? { url: base + item.number, state: closed.has(item.number) ? 'CLOSED' : item.state } : null);
  const connection = c => ({ nodes: (c?.nodes || []).map(ref) });
  return snapshot.data.repository.issues.nodes.map(item => normalizeIssueRelations({ ...ref(item), parent: ref(item.parent), subIssues: connection(item.subIssues), blockedBy: connection(item.blockedBy), blocking: connection(item.blocking) }));
};
for (let wave = 1; ; wave++) {
  const relations = build();
  const open = relations.filter(relation => relation.state === 'OPEN');
  if (open.length === 0) break;
  const plan = planIssueQueue(
    open.map(relation => relation.url),
    new Map(relations.map(relation => [relation.key, relation]))
  );
  if (plan.ready.length === 0) {
    console.log(
      'stuck:',
      plan.waiting.map(entry => entry.url)
    );
    break;
  }
  console.log(`wave ${wave}: ${plan.ready.map(entry => `#${entry.url.split('/').pop()}`).join(', ')}`);
  for (const entry of plan.ready) closed.add(Number(entry.url.split('/').pop()));
}
