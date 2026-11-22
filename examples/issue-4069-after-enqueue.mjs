#!/usr/bin/env node

/**
 * Issue #4069 — see `/after`, `/enqueue` and `--respect-blockers` at work
 * without a bot, GitHub or running sessions.
 *
 * 1. A batch `/solve 1 2 3 4 5` on a small issue graph is ordered so the
 *    unblocked issues start first and each blocked one after its blockers.
 * 2. Each link is planned as the bot plans it with blockers respected: the
 *    ready ones start, the blocked ones wait for their queued blockers.
 * 3. A hand-built chain: `/after A` → B, `/after B` → C and `/enqueue A` → D.
 *    A fails, so B and C fail without starting; D starts anyway.
 *
 * Usage: node examples/issue-4069-after-enqueue.mjs
 */

import { normalizeIssueRelations } from '../src/hive.issue-relations.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { createItemTarget, DEPENDENCY_MODE } from '../src/telegram-solve-dependencies.lib.mjs';
import { orderBatchByBlockers, planBlockerWait } from '../src/telegram-solve-blockers.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';

await initI18n('en');

const url = n => `https://github.com/demo/repo/issues/${n}`;

/** { n: { parent, blockedBy } } → the relations map `/hive` builds from GitHub. */
function relationsOf(spec) {
  const all = new Map(Object.entries(spec).map(([n, item]) => [Number(n), { parent: null, blockedBy: [], ...item }]));
  const ref = n => ({ url: url(n), state: 'OPEN' });
  const relations = new Map();
  for (const [n, item] of all) {
    const subs = [...all].filter(([, other]) => other.parent === n).map(([m]) => m);
    const blocking = [...all].filter(([, other]) => other.blockedBy.includes(n)).map(([m]) => m);
    const relation = normalizeIssueRelations({ url: url(n), state: 'OPEN', stateReason: null, parent: item.parent ? ref(item.parent) : null, subIssues: { nodes: subs.map(ref) }, blockedBy: { nodes: item.blockedBy.map(ref) }, blocking: { nodes: blocking.map(ref) } });
    relations.set(relation.key, relation);
  }
  return relations;
}

function newQueue() {
  const queue = new SolveQueue({ verbose: false, autoStart: false, isSessionActive: () => false });
  queue.log = () => {};
  queue.updateItemMessage = async () => {}; // no Telegram here
  return queue;
}

const short = value => value.replace('https://github.com/demo/repo/issues/', '#');

// --- 1. Batch order -----------------------------------------------------------
// #1 is blocked by #2, #2 by #3; #5 is the parent of sub-issue #4.
const relations = relationsOf({ 1: { blockedBy: [2] }, 2: { blockedBy: [3] }, 3: {}, 4: { parent: 5 }, 5: {} });
const written = [1, 2, 3, 4, 5].map(url);
const order = orderBatchByBlockers(written, relations);
console.log('1. /solve', written.map(short).join(' '));
console.log(`   start order: ${order.urls.map(short).join(' → ')} (${order.ready} ready, ${order.waiting} waiting)\n`);

// --- 2. Launch each link with blockers respected ------------------------------
console.log('2. Launching in that order with --respect-blockers:');
const batchQueue = newQueue();
for (const link of order.urls) {
  const plan = await planBlockerWait({ url: link, relations, solveQueue: batchQueue });
  if (plan.action === 'wait') {
    batchQueue.enqueueAfter({ url: link, args: [link], requester: 'demo', infoBlock: short(link) }, { targets: plan.targets, mode: DEPENDENCY_MODE.SUCCESS });
    console.log(`   ${short(link)}: waits for ${plan.targets.map(target => target.label).join(', ')}`);
  } else if (plan.action === 'start') {
    batchQueue.enqueue({ url: link, args: [link], requester: 'demo', infoBlock: short(link) });
    console.log(`   ${short(link)}: queued to start now`);
  } else {
    console.log(`   ${short(link)}: refused — ${plan.missing.map(item => `${short(item.url)} ${item.detail}`).join('; ')}`);
  }
}
const lonely = await planBlockerWait({ url: url(1), relations, solveQueue: newQueue() });
console.log(`   (alone, ${short(url(1))} would be ${lonely.action === 'reject' ? 'refused: its blocker is not queued' : lonely.action})\n`);
batchQueue.dependencies.stop();

// --- 3. A hand-built chain ----------------------------------------------------
console.log('3. /after and /enqueue chain:');
const queue = newQueue();
const a = queue.enqueue({ url: url(10), args: [url(10)], requester: 'demo', infoBlock: 'A' });
const b = queue.enqueueAfter({ url: url(11), args: [url(11)], requester: 'demo', infoBlock: 'B' }, { targets: [createItemTarget(a)], mode: DEPENDENCY_MODE.SUCCESS });
const c = queue.enqueueAfter({ url: url(12), args: [url(12)], requester: 'demo', infoBlock: 'C' }, { targets: [createItemTarget(b)], mode: DEPENDENCY_MODE.SUCCESS });
const d = queue.enqueueAfter({ url: url(13), args: [url(13)], requester: 'demo', infoBlock: 'D' }, { targets: [createItemTarget(a)], mode: DEPENDENCY_MODE.FINISH });
const show = label => console.log(`   ${label}: A=${a.status} B=${b.status} C=${c.status} D=${d.status}`);
show('before A starts');

// A starts and its session fails (exit code 1).
queue.queues.claude.splice(queue.queues.claude.indexOf(a), 1);
a.status = 'started';
a.sessionName = 'solve-a';
queue.completed.push(a);
queue.recordSessionCompletion({ sessionName: 'solve-a', url: a.url, tool: 'claude', exitCode: 1, status: 'executed' });
await queue.reconcileDependencies();
show('after A failed');
console.log(`   B: ${b.error}`);
console.log(`   C: ${c.error}`);
queue.dependencies.stop();
