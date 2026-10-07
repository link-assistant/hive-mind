#!/usr/bin/env node
// Issue #2615: run the relations planner on a saved snapshot of link-assistant/calculator.
// Usage: node experiments/issue-2615-plan-calculator-fixture.mjs [path-to-snapshot.json]
import { readFileSync } from 'node:fs';
import { normalizeIssueRelations, planIssueQueue, describeWaitReasons } from '../src/hive.issue-relations.lib.mjs';

const path = process.argv[2] || new URL('../docs/case-studies/issue-2615/data/calculator-open-issues-relations.json', import.meta.url);
const snapshot = JSON.parse(readFileSync(path, 'utf8'));
const base = 'https://github.com/link-assistant/calculator/issues/';
const toRef = node => (node ? { url: base + node.number, state: node.state } : null);
const toConnection = connection => ({ nodes: (connection?.nodes || []).map(toRef) });
const relations = new Map();
const urls = [];
for (const node of snapshot.data.repository.issues.nodes) {
  const relation = normalizeIssueRelations({ ...toRef(node), parent: toRef(node.parent), subIssues: toConnection(node.subIssues), blockedBy: toConnection(node.blockedBy), blocking: toConnection(node.blocking) });
  relations.set(relation.key, relation);
  urls.push(relation.url);
}
const plan = planIssueQueue(urls, relations);
console.log('READY (in queue order):');
for (const entry of plan.ready) console.log(`  ${entry.url}  criticalPath=${entry.criticalPath} unblocks=${entry.unblocks}`);
console.log(`WAITING (${plan.waiting.length}):`);
for (const entry of plan.waiting) console.log(`  ${entry.url}: ${describeWaitReasons(entry.url, entry.reasons)}`);
console.log('CYCLES:', JSON.stringify(plan.cycles));
