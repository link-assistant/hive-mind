/**
 * @hive-mind-test-suite default
 *
 * Issue #2615: /hive must respect GitHub sub-issues (parent/child) and issue dependencies
 * (blocked by / blocking). Only the ready frontier — open issues with no open blockers (own or
 * inherited from a parent) and no open sub-issues — may be queued, critical path first, so
 * --concurrency > 1 runs exactly the issues that can be worked on in parallel.
 *
 * The main fixture is a real snapshot of link-assistant/calculator, the repository named in
 * the issue (docs/case-studies/issue-2615/data/calculator-open-issues-relations.json).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2615
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildIssueRelationsQuery, createIssueRelationsFetcher, createIssueRelationsGate, describeWaitReasons, formatIssueRef, normalizeIssueRelations, parseIssueRef, planIssueQueue } from '../src/hive.issue-relations.lib.mjs';
import { IssueQueue } from '../src/hive.issue-queue.lib.mjs';

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    throw error;
  }
};
const noop = async () => {};

// --- Fixtures ----------------------------------------------------------------

const CALC = 'https://github.com/link-assistant/calculator/issues/';
const calculatorSnapshot = JSON.parse(readFileSync(new URL('../docs/case-studies/issue-2615/data/calculator-open-issues-relations.json', import.meta.url), 'utf8'));

/** The snapshot stores issue numbers; turn it into GraphQL nodes keyed by URL. */
const calculatorNodes = (closed = []) => {
  const closedSet = new Set(closed);
  const ref = item => (item ? { url: CALC + item.number, state: closedSet.has(item.number) ? 'CLOSED' : item.state } : null);
  const connection = c => ({ nodes: (c?.nodes || []).map(ref) });
  return calculatorSnapshot.data.repository.issues.nodes.map(item => ({ ...ref(item), parent: ref(item.parent), subIssues: connection(item.subIssues), blockedBy: connection(item.blockedBy), blocking: connection(item.blocking) }));
};
const relationsOf = nodes => new Map(nodes.map(normalizeIssueRelations).map(relation => [relation.key, relation]));
const num = url => Number(url.split('/').pop());

/**
 * A tiny graph DSL for repository o/r: { 1: { parent: 2, blockedBy: [3], state: 'CLOSED' } }.
 * Inverse edges (subIssues, blocking) are derived so the data is consistent like GitHub's.
 */
const OR = 'https://github.com/o/r/issues/';
const graphNodes = spec => {
  const all = new Map(Object.keys(spec).map(n => [Number(n), { parent: null, blockedBy: [], state: 'OPEN', ...spec[n] }]));
  const ref = n => ({ url: OR + n, state: all.get(n)?.state ?? 'OPEN' });
  const nodes = {};
  for (const [n, item] of all) {
    const subs = [...all].filter(([, other]) => other.parent === n).map(([m]) => m);
    const blocking = [...all].filter(([, other]) => other.blockedBy.includes(n)).map(([m]) => m);
    nodes[OR + n] = { url: OR + n, state: item.state, stateReason: null, parent: item.parent ? ref(item.parent) : null, subIssues: { nodes: subs.map(ref) }, blockedBy: { nodes: item.blockedBy.map(ref) }, blocking: { nodes: blocking.map(ref) } };
  }
  return nodes;
};

/** A fake `gh api graphql` that answers the aliased query from a URL -> node table. */
const fakeGraphQL = (nodesByUrl, calls = []) => {
  return async query => {
    calls.push(query);
    const data = {};
    for (const segment of query.split(/(?=r\d+: repository\()/).slice(1)) {
      const [, repoAlias, owner, name] = segment.match(/^(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/);
      data[repoAlias] = {};
      for (const [, issueAlias, number] of segment.matchAll(/(i\d+): issue\(number: (\d+)\)/g)) {
        data[repoAlias][issueAlias] = nodesByUrl[`https://github.com/${owner}/${name}/issues/${number}`] ?? null;
      }
    }
    return { stdout: JSON.stringify({ data }) };
  };
};

// --- 1. URL helpers and the query --------------------------------------------

await test('parseIssueRef / formatIssueRef', () => {
  assert.deepEqual(parseIssueRef('https://github.com/Link-Assistant/Calculator/issues/229'), { owner: 'Link-Assistant', repo: 'Calculator', number: 229, key: 'link-assistant/calculator#229', url: 'https://github.com/Link-Assistant/Calculator/issues/229' });
  assert.equal(parseIssueRef('https://github.com/o/r/pull/1'), null);
  assert.equal(parseIssueRef(undefined), null);
  assert.equal(formatIssueRef(CALC + 229, CALC + 1), '#229');
  assert.equal(formatIssueRef('https://github.com/x/y/issues/3', CALC + 1), 'x/y#3');
});

await test('buildIssueRelationsQuery batches by repository and never contains single quotes', () => {
  const refs = [CALC + 1, CALC + 2, 'https://github.com/x/y/issues/3', "https://github.com/x/b'ad/issues/4"].map(parseIssueRef);
  const { query, aliases } = buildIssueRelationsQuery(refs);
  assert.equal(aliases.length, 3, 'unsafe owner/repo names are dropped');
  assert.equal((query.match(/repository\(/g) || []).length, 2);
  assert(!query.includes("'"), 'query is passed inside single quotes to gh');
  for (const field of ['parent {', 'subIssues(first: 100)', 'blockedBy(first: 50)', 'blocking(first: 50)']) assert(query.includes(field), `query requests ${field}`);
});

// --- 2. Planning on the real calculator graph --------------------------------

await test('calculator: only #229-#232 are ready, #229 (critical path) first, parent #227 waits', () => {
  const nodes = calculatorNodes();
  const plan = planIssueQueue(
    nodes.map(n => n.url),
    relationsOf(nodes)
  );
  assert.deepEqual(plan.ready.map(entry => num(entry.url)).slice(0, 1), [229]);
  assert.deepEqual(plan.ready.map(entry => num(entry.url)).sort(), [229, 230, 231, 232]);
  assert.equal(plan.waiting.length, 15);
  assert.deepEqual(plan.cycles, []);
  const parent = plan.waiting.find(entry => num(entry.url) === 227);
  assert.equal(parent.reasons[0].type, 'open-sub-issues');
  assert.equal(parent.reasons[0].refs.length, 18);
  const integration = plan.waiting.find(entry => num(entry.url) === 246);
  assert.match(describeWaitReasons(integration.url, integration.reasons), /^blocked by #245, #244, .*#230$/);
});

await test('calculator: ties keep hive order (--issue-order) and ready issues are not limited to one', () => {
  const nodes = calculatorNodes();
  const desc = nodes.map(n => n.url).reverse();
  const plan = planIssueQueue(desc, relationsOf(nodes));
  assert.deepEqual(
    plan.ready.map(entry => num(entry.url)),
    [229, 232, 231, 230]
  );
});

await test('calculator: closing #229 opens the next frontier', () => {
  const nodes = calculatorNodes([229]);
  const open = nodes.filter(n => n.state === 'OPEN');
  const plan = planIssueQueue(
    open.map(n => n.url),
    relationsOf(nodes)
  );
  assert.deepEqual(plan.ready.map(entry => num(entry.url)).sort(), [230, 231, 232, 233, 234, 237, 239, 242, 243]);
});

await test('calculator: when every child is closed the parent becomes ready', () => {
  const children = Array.from({ length: 18 }, (_, i) => 229 + i);
  const nodes = calculatorNodes(children);
  const plan = planIssueQueue([CALC + 227], relationsOf(nodes));
  assert.deepEqual(
    plan.ready.map(entry => num(entry.url)),
    [227]
  );
});

// --- 3. Rules on small graphs -----------------------------------------------

await test('a child inherits its parent’s open blockers, but not a blocker inside the same subtree', () => {
  // 10 is blocked by external 20 and by its own child 12; children 11 and 12.
  const nodes = graphNodes({ 10: { blockedBy: [20, 12] }, 11: { parent: 10 }, 12: { parent: 10 }, 20: {} });
  const relations = relationsOf(Object.values(nodes));
  const plan = planIssueQueue([OR + 11, OR + 12, OR + 20], relations);
  assert.deepEqual(
    plan.ready.map(entry => num(entry.url)),
    [20]
  );
  const child = plan.waiting.find(entry => num(entry.url) === 11);
  assert.equal(describeWaitReasons(child.url, child.reasons), 'parent #10 is blocked by #20');
  // Once 20 is closed, both children are free, even though 10 is still blocked by child 12.
  const after = relationsOf(Object.values(graphNodes({ 10: { blockedBy: [20, 12] }, 11: { parent: 10 }, 12: { parent: 10 }, 20: { state: 'CLOSED' } })));
  assert.deepEqual(
    planIssueQueue([OR + 11, OR + 12], after).ready.map(entry => num(entry.url)),
    [11, 12]
  );
});

await test('closed blockers do not hold an issue regardless of close reason', () => {
  const nodes = graphNodes({ 1: { blockedBy: [2, 3] }, 2: { state: 'CLOSED' }, 3: { state: 'CLOSED' } });
  assert.equal(planIssueQueue([OR + 1], relationsOf(Object.values(nodes))).ready.length, 1);
});

await test('dependency cycles are reported and nothing in them is queued', () => {
  const nodes = graphNodes({ 1: { blockedBy: [2] }, 2: { blockedBy: [1] }, 3: {} });
  const plan = planIssueQueue([OR + 1, OR + 2, OR + 3], relationsOf(Object.values(nodes)));
  assert.deepEqual(
    plan.ready.map(entry => num(entry.url)),
    [3]
  );
  assert.deepEqual(plan.cycles, [['o/r#1', 'o/r#2']]);
});

await test('issues without relation data are queued (fail open, previous behaviour)', () => {
  const plan = planIssueQueue([OR + 99, 'https://example.com/x'], new Map());
  assert.equal(plan.ready.length, 2);
  assert.equal(plan.unknown.length, 2);
});

// --- 4. Fetching ---------------------------------------------------------------

await test('fetcher walks up to ancestors and to blockers of ancestors in a few batched queries', async () => {
  const nodes = graphNodes({ 1: { parent: 2 }, 2: { parent: 3 }, 3: { blockedBy: [4] }, 4: {} });
  const calls = [];
  const fetch = createIssueRelationsFetcher({ execGraphQL: fakeGraphQL(nodes, calls) });
  const relations = await fetch([OR + 1]);
  assert.deepEqual([...relations.keys()].sort(), ['o/r#1', 'o/r#2', 'o/r#3', 'o/r#4']);
  assert(calls.length <= 4, `expected at most 4 queries, got ${calls.length}`);
  const plan = planIssueQueue([OR + 1], relations);
  assert.equal(describeWaitReasons(OR + 1, plan.waiting[0].reasons), 'parent #3 is blocked by #4');
});

await test('fetcher splits large candidate lists into batches', async () => {
  const spec = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i + 1, {}]));
  const calls = [];
  const fetch = createIssueRelationsFetcher({ execGraphQL: fakeGraphQL(graphNodes(spec), calls), batchSize: 25 });
  const relations = await fetch(Object.keys(spec).map(n => OR + n));
  assert.equal(relations.size, 60);
  assert.equal(calls.length, 3);
});

await test('fetcher keeps partial data when gh exits non-zero because of a GraphQL error', async () => {
  const nodes = graphNodes({ 1: {} });
  const execGraphQL = async () => {
    const error = new Error('gh: Could not resolve to an Issue with the number of 2.');
    error.stdout = JSON.stringify({ data: { r0: { i0: nodes[OR + 1], i1: null } }, errors: [{ message: 'Could not resolve to an Issue with the number of 2.' }] });
    throw error;
  };
  const relations = await createIssueRelationsFetcher({ execGraphQL })([OR + 1, OR + 2]);
  assert.deepEqual([...relations.keys()], ['o/r#1']);
});

// --- 5. The gate hive.mjs uses --------------------------------------------------

await test('gate filters and orders issue objects, keeps unknown fields, and logs why issues wait', async () => {
  const nodes = calculatorNodes();
  const messages = [];
  const gate = createIssueRelationsGate({ enabled: true, fetchIssueRelations: createIssueRelationsFetcher({ execGraphQL: fakeGraphQL(Object.fromEntries(nodes.map(n => [n.url, n]))) }), log: async message => messages.push(message) });
  const issues = nodes.map(n => ({ url: n.url, title: `Issue ${num(n.url)}` }));
  const ready = await gate.filterReadyIssues(issues);
  assert.equal(ready[0].title, 'Issue 229');
  assert.equal(ready.length, 4);
  assert.equal(gate.getWaitingCount(), 15);
  assert(messages.some(message => message.includes('Waiting (18 open sub-issues') && message.endsWith(CALC + 227)));
  assert(messages.some(message => message.includes('4 ready') && message.includes('15 waiting')));
});

await test('gate is a no-op when disabled and fails open when relations cannot be read', async () => {
  const issues = [{ url: OR + 1 }, { url: OR + 2 }];
  const disabled = createIssueRelationsGate({
    enabled: false,
    fetchIssueRelations: () => {
      throw new Error('must not be called');
    },
    log: noop,
  });
  assert.equal(await disabled.filterReadyIssues(issues), issues);
  const warnings = [];
  const broken = createIssueRelationsGate({
    enabled: true,
    fetchIssueRelations: async () => {
      throw new Error("Field 'blockedBy' doesn't exist on type 'Issue'");
    },
    log: async (message, options) => options?.level === 'warning' && warnings.push(message),
  });
  assert.equal(await broken.filterReadyIssues(issues), issues);
  assert.equal(warnings.length, 1);
  assert.deepEqual(await broken.checkIssueReady(OR + 1), { ready: true });
});

await test('gate rechecks a single issue right before a worker starts it', async () => {
  const nodes = graphNodes({ 1: { blockedBy: [2] }, 2: {}, 3: {} });
  const gate = createIssueRelationsGate({ enabled: true, fetchIssueRelations: createIssueRelationsFetcher({ execGraphQL: fakeGraphQL(nodes) }), log: noop });
  assert.deepEqual(await gate.checkIssueReady(OR + 1), { ready: false, reason: 'blocked by #2' });
  assert.deepEqual(await gate.checkIssueReady(OR + 3), { ready: true });
});

await test('--once starts another round only while issues wait and work keeps completing', async () => {
  const nodes = graphNodes({ 1: { blockedBy: [2] }, 2: {} });
  const gate = createIssueRelationsGate({ enabled: true, fetchIssueRelations: createIssueRelationsFetcher({ execGraphQL: fakeGraphQL(nodes) }), log: noop });
  await gate.filterReadyIssues([{ url: OR + 1 }, { url: OR + 2 }]);
  assert.equal(gate.shouldStartAnotherOnceRound(0), false, 'nothing completed: no progress possible');
  assert.equal(gate.shouldStartAnotherOnceRound(1), true, '#2 completed, #1 may now be unblocked');
  assert.equal(gate.shouldStartAnotherOnceRound(1), false, 'no new completions since the last round');
  await gate.filterReadyIssues([{ url: OR + 3 }]);
  assert.equal(gate.shouldStartAnotherOnceRound(2), false, 'nothing is waiting');
  assert.equal(gate.shouldStartAnotherOnceRound(3, 1), true, 'an issue deferred at dequeue counts as waiting');
});

// --- 6. Queue and hive.mjs wiring -------------------------------------------------

await test('IssueQueue.defer releases an issue without completing it, so it can be queued again', () => {
  const queue = new IssueQueue();
  queue.enqueue(OR + 1);
  assert.equal(queue.dequeue(), OR + 1);
  queue.defer(OR + 1);
  assert.deepEqual([queue.getStats().processing, queue.getStats().completed, queue.getStats().waiting], [0, 0, 1]);
  assert.equal(queue.enqueue(OR + 1), true);
  assert.equal(queue.getStats().waiting, 0);
  queue.dequeue();
  queue.markFailed(OR + 1);
  assert.equal(queue.enqueue(OR + 1, { skipFailed: true }), false, 'extra --once rounds do not retry failures');
  assert.equal(queue.enqueue(OR + 1), true, 'continuous mode keeps retrying failed issues as before');
});

await test('hive.mjs wires the gate in before --max-issues, defers at dequeue and accepts /issues URLs', () => {
  const hiveSrc = readFileSync(new URL('../src/hive.mjs', import.meta.url), 'utf8');
  const filterAt = hiveSrc.indexOf('relationsGate.filterReadyIssues(issuesToProcess)');
  const limitAt = hiveSrc.indexOf('issuesToProcess.slice(0, argv.maxIssues)');
  assert(filterAt > 0 && limitAt > filterAt, 'relations are applied before the --max-issues slice');
  assert(/relationsGate\.checkIssueReady\(issueUrl\)[\s\S]{0,300}issueQueue\.defer\(issueUrl\)/.test(hiveSrc), 'workers defer issues that became blocked');
  assert(hiveSrc.includes("parsedUrl.type === 'issues_list' || parsedUrl.type === 'pulls_list'"), 'hive accepts owner/repo/issues URLs');
  assert(hiveSrc.includes('relationsGate.shouldStartAnotherOnceRound('), '--once re-polls after progress');
  const configSrc = readFileSync(new URL('../src/hive.config.lib.mjs', import.meta.url), 'utf8');
  assert(configSrc.includes("'respect-issue-relations'"), 'option is registered as hive-only');
});

console.log(`\n${passed} tests passed`);
