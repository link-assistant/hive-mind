// Issue #2615: make /hive respect GitHub issue relations when it fills its queue.
//
// GitHub has two native relations between issues that describe *order of work*:
//
//   - sub-issues (parent / child): a parent is only done when its children are done;
//   - issue dependencies ("blocked by" / "blocking"): a blocked issue must wait until every
//     issue blocking it is closed (in practice: its pull request is merged).
//
// Before this module hive queued every matching issue at once, so with --concurrency > 1 it
// happily started a task whose prerequisites were still unmerged, and started a parent before
// its sub-issues. Now hive only queues the *ready frontier* of the relation graph: open issues
// with no open blockers (including blockers inherited from an ancestor) and no open
// sub-issues. Every ready issue can run in parallel; the rest wait for the next polling
// iteration, when merged prerequisites have closed their issues.
//
// Ready issues are ordered critical-path first (the issue that transitively unblocks the
// longest chain of work starts first), then by how many issues it unblocks, then by the
// order hive already had (--issue-order).
//
// Everything here is dependency-injected (execGh, log) so it can be tested without network.
//
// @see https://github.com/link-assistant/hive-mind/issues/2615
// @see docs/case-studies/issue-2615/README.md

// GitHub limits: 100 sub-issues per parent, 50 issues per dependency type, 8 nesting levels.
// Asking for the maximum means the lists below are complete, not a first page.
export const SUB_ISSUES_LIMIT = 100;
export const DEPENDENCIES_LIMIT = 50;
export const MAX_SUB_ISSUE_DEPTH = 8;

const ISSUE_URL_PATTERN = /github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/i;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse a GitHub issue URL into a stable relation key.
 * @param {string} url
 * @returns {{owner: string, repo: string, number: number, key: string, url: string}|null}
 */
export function parseIssueRef(url) {
  const match = typeof url === 'string' ? url.match(ISSUE_URL_PATTERN) : null;
  if (!match) return null;
  const [, owner, repo, number] = match;
  return { owner, repo, number: Number(number), key: `${owner}/${repo}#${number}`.toLowerCase(), url: `https://github.com/${owner}/${repo}/issues/${number}` };
}

/** Format an issue reference relative to the repository of another issue: `#12` or `owner/repo#12`. */
export function formatIssueRef(url, relativeToUrl = null) {
  const ref = parseIssueRef(url);
  if (!ref) return String(url);
  const base = relativeToUrl ? parseIssueRef(relativeToUrl) : null;
  if (base && base.owner.toLowerCase() === ref.owner.toLowerCase() && base.repo.toLowerCase() === ref.repo.toLowerCase()) return `#${ref.number}`;
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

const REF_FIELDS = 'url state';
export const ISSUE_RELATIONS_FIELDS = `url state stateReason parent { ${REF_FIELDS} } subIssues(first: ${SUB_ISSUES_LIMIT}) { totalCount nodes { ${REF_FIELDS} } } blockedBy(first: ${DEPENDENCIES_LIMIT}) { totalCount nodes { ${REF_FIELDS} } } blocking(first: ${DEPENDENCIES_LIMIT}) { totalCount nodes { ${REF_FIELDS} } }`;

/**
 * Build one GraphQL query that reads the relations of many issues, grouped by repository.
 * Aliases: `r<repoIndex>` for repositories and `i<issueIndex>` for issues.
 * @param {Array<{owner: string, repo: string, number: number}>} refs
 * @returns {{query: string, aliases: Array<{repoAlias: string, issueAlias: string, ref: object}>}}
 */
export function buildIssueRelationsQuery(refs) {
  const byRepo = new Map();
  for (const ref of refs) {
    if (!SAFE_NAME_PATTERN.test(ref.owner) || !SAFE_NAME_PATTERN.test(ref.repo)) continue;
    const repoKey = `${ref.owner}/${ref.repo}`.toLowerCase();
    if (!byRepo.has(repoKey)) byRepo.set(repoKey, { owner: ref.owner, repo: ref.repo, refs: [] });
    byRepo.get(repoKey).refs.push(ref);
  }
  const aliases = [];
  const repoBlocks = [];
  let repoIndex = 0;
  let issueIndex = 0;
  for (const group of byRepo.values()) {
    const repoAlias = `r${repoIndex++}`;
    const issueBlocks = group.refs.map(ref => {
      const issueAlias = `i${issueIndex++}`;
      aliases.push({ repoAlias, issueAlias, ref });
      return `${issueAlias}: issue(number: ${Number(ref.number)}) { ${ISSUE_RELATIONS_FIELDS} }`;
    });
    repoBlocks.push(`${repoAlias}: repository(owner: "${group.owner}", name: "${group.repo}") { ${issueBlocks.join(' ')} }`);
  }
  return { query: `query HiveIssueRelations { ${repoBlocks.join(' ')} }`, aliases };
}

const normalizeRefs = connection => (connection?.nodes || []).filter(node => node && parseIssueRef(node.url)).map(node => ({ url: parseIssueRef(node.url).url, state: node.state }));

/**
 * Normalize one GraphQL issue node into the shape the planner uses.
 * @param {object} node
 */
export function normalizeIssueRelations(node) {
  const ref = node && parseIssueRef(node.url);
  if (!ref) return null;
  const parent = node.parent && parseIssueRef(node.parent.url) ? { url: parseIssueRef(node.parent.url).url, state: node.parent.state } : null;
  return {
    key: ref.key,
    url: ref.url,
    state: node.state,
    stateReason: node.stateReason || null,
    parent,
    subIssues: normalizeRefs(node.subIssues),
    blockedBy: normalizeRefs(node.blockedBy),
    blocking: normalizeRefs(node.blocking),
  };
}

const isOpen = ref => ref?.state === 'OPEN';

// `gh api graphql` exits non-zero when the response carries `errors` (for example NOT_FOUND
// for one deleted issue in a batch) but still prints the partial `data` — keep that data.
const parseGraphQLOutput = (stdout, error = null) => {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    if (error) throw error;
    throw new Error('GitHub GraphQL returned a non-JSON response');
  }
  if (!parsed?.data) {
    const message = (parsed?.errors || []).map(entry => entry.message).join('; ');
    throw error || new Error(message || 'GitHub GraphQL returned no data');
  }
  return parsed;
};

/**
 * Run a relations query through `gh api graphql` (the query never contains single quotes:
 * owner/repo names are validated and numbers are numeric).
 * @param {object} deps
 * @param {Function} deps.execGhWithRetry - from github-rate-limit.lib.mjs
 * @param {number} [deps.maxBuffer]
 */
export const createGhGraphQLRunner =
  ({ execGhWithRetry, maxBuffer = 10 * 1024 * 1024 }) =>
  query =>
    execGhWithRetry(`gh api graphql -f query='${query}'`, { execOptions: { encoding: 'utf8', maxBuffer, env: process.env }, label: 'issue relations' });

/**
 * Create a fetcher that reads the relations of a set of issues, plus everything needed to
 * judge them: the full ancestor chain of every issue (blockers are inherited from parents),
 * and the open blockers of those ancestors (so a parent blocked by its own child does not
 * stall that child's siblings).
 *
 * @param {object} deps
 * @param {(query: string) => Promise<{stdout: string}>} deps.execGraphQL - runs a GraphQL query
 * @param {Function} [deps.log]
 * @param {number} [deps.batchSize]
 * @returns {(urls: string[]) => Promise<Map<string, object>>}
 */
export function createIssueRelationsFetcher({ execGraphQL, log = async () => {}, batchSize = 25 }) {
  const fetchBatch = async refs => {
    const { query, aliases } = buildIssueRelationsQuery(refs);
    if (aliases.length === 0) return [];
    let parsed;
    try {
      const { stdout } = await execGraphQL(query);
      parsed = parseGraphQLOutput(stdout);
    } catch (error) {
      if (typeof error?.stdout === 'string' && error.stdout.trim()) parsed = parseGraphQLOutput(error.stdout, error);
      else throw error;
    }
    if (parsed.errors?.length) await log(`   ⚠️  Issue relations query reported: ${parsed.errors.map(entry => entry.message).join('; ')}`, { verbose: true });
    return aliases.map(({ repoAlias, issueAlias }) => normalizeIssueRelations(parsed.data?.[repoAlias]?.[issueAlias])).filter(Boolean);
  };

  return async function fetchIssueRelations(urls) {
    const relations = new Map();
    const requested = new Set();
    const ancestorKeys = new Set();
    const expandedAncestors = new Set();
    let pending = [];
    const want = url => {
      const ref = parseIssueRef(url);
      if (ref && !relations.has(ref.key) && !requested.has(ref.key)) {
        requested.add(ref.key);
        pending.push(ref);
      }
    };
    for (const url of urls) want(url);
    // Each round walks one level up the sub-issue tree; GitHub allows 8 levels, a couple of
    // extra rounds cover the blockers-of-ancestors look-ups.
    for (let round = 0; pending.length > 0 && round < MAX_SUB_ISSUE_DEPTH + 3; round++) {
      const current = pending;
      pending = [];
      for (let index = 0; index < current.length; index += batchSize) {
        for (const relation of await fetchBatch(current.slice(index, index + batchSize))) relations.set(relation.key, relation);
      }
      for (const ref of current) {
        const parent = relations.get(ref.key)?.parent;
        if (!parent) continue;
        ancestorKeys.add(parseIssueRef(parent.url).key);
        want(parent.url);
      }
      // Open blockers of ancestors are inherited by descendants — unless the blocker is itself a
      // descendant of that ancestor, which needs the blocker's own ancestry to tell.
      for (const key of ancestorKeys) {
        const ancestor = relations.get(key);
        if (!ancestor || expandedAncestors.has(key)) continue;
        expandedAncestors.add(key);
        for (const blocker of ancestor.blockedBy.filter(isOpen)) want(blocker.url);
      }
    }
    return relations;
  };
}

/** Ancestors of an issue (nearest first), as far as `relations` knows them. */
export function getAncestors(key, relations) {
  const ancestors = [];
  const seen = new Set([key]);
  let current = relations.get(key);
  while (current?.parent) {
    const parentKey = parseIssueRef(current.parent.url).key;
    if (seen.has(parentKey)) break;
    seen.add(parentKey);
    const parent = relations.get(parentKey);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

const isDescendantOf = (key, ancestorKey, relations) => getAncestors(key, relations).some(ancestor => ancestor.key === ancestorKey);

/**
 * Why an open issue must wait, from its relations. An empty list means it is ready.
 * @returns {Array<{type: string, refs?: Array<object>, ancestor?: object}>}
 */
export function getWaitReasons(relation, relations, { inheritParentBlockers = true } = {}) {
  const reasons = [];
  const openBlockers = relation.blockedBy.filter(isOpen);
  if (openBlockers.length > 0) reasons.push({ type: 'blocked-by', refs: openBlockers });
  const openSubIssues = relation.subIssues.filter(isOpen);
  if (openSubIssues.length > 0) reasons.push({ type: 'open-sub-issues', refs: openSubIssues });
  if (inheritParentBlockers) {
    for (const ancestor of getAncestors(relation.key, relations)) {
      // A parent blocked by one of its own descendants (or by this very issue) only holds the
      // parent back — inheriting that would deadlock the descendants.
      const inherited = ancestor.blockedBy.filter(blocker => {
        if (!isOpen(blocker)) return false;
        const blockerKey = parseIssueRef(blocker.url).key;
        return blockerKey !== relation.key && !isDescendantOf(blockerKey, ancestor.key, relations);
      });
      if (inherited.length > 0) reasons.push({ type: 'ancestor-blocked-by', ancestor: { url: ancestor.url, state: ancestor.state }, refs: inherited });
    }
  }
  return reasons;
}

/**
 * "X waits for Y" edges between open issues known to `relations` (and the open issues they
 * name). Used for prioritisation and for cycle detection.
 * @returns {Map<string, Set<string>>} waitsFor: key -> keys it waits for
 */
export function buildWaitGraph(relations, options = {}) {
  const waitsFor = new Map();
  const addEdge = (from, to) => {
    if (from === to) return;
    if (!waitsFor.has(from)) waitsFor.set(from, new Set());
    waitsFor.get(from).add(to);
  };
  for (const relation of relations.values()) {
    if (!isOpen(relation)) continue;
    for (const reason of getWaitReasons(relation, relations, options)) {
      for (const ref of reason.refs) addEdge(relation.key, parseIssueRef(ref.url).key);
    }
    // `blocking` is the other side of `blockedBy`; it names dependents that were not fetched.
    for (const dependent of relation.blocking.filter(isOpen)) addEdge(parseIssueRef(dependent.url).key, relation.key);
    if (relation.parent && isOpen(relation.parent)) addEdge(parseIssueRef(relation.parent.url).key, relation.key);
  }
  return waitsFor;
}

/** Strongly connected components with more than one member: dependency cycles nothing can break. */
export function findWaitCycles(waitsFor) {
  let index = 0;
  const indices = new Map();
  const lowlinks = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  const strongConnect = node => {
    indices.set(node, index);
    lowlinks.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);
    for (const next of waitsFor.get(node) || []) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(next)));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(next)));
      }
    }
    if (lowlinks.get(node) === indices.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) cycles.push(component.sort());
    }
  };
  for (const node of waitsFor.keys()) if (!indices.has(node)) strongConnect(node);
  return cycles;
}

/**
 * For every issue: the longest chain of issues waiting on it (critical path) and how many
 * issues transitively wait on it. Cycles are cut, so the numbers stay finite.
 */
export function computeUnblockScores(waitsFor) {
  const dependents = new Map();
  for (const [from, targets] of waitsFor) {
    for (const to of targets) {
      if (!dependents.has(to)) dependents.set(to, new Set());
      dependents.get(to).add(from);
    }
  }
  const depthMemo = new Map();
  const depth = (node, visiting = new Set()) => {
    if (depthMemo.has(node)) return depthMemo.get(node);
    if (visiting.has(node)) return 0;
    visiting.add(node);
    let best = 0;
    for (const next of dependents.get(node) || []) best = Math.max(best, 1 + depth(next, visiting));
    visiting.delete(node);
    depthMemo.set(node, best);
    return best;
  };
  const count = node => {
    const seen = new Set([node]);
    const queue = [node];
    while (queue.length > 0) {
      for (const next of dependents.get(queue.shift()) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen.size - 1;
  };
  return key => ({ criticalPath: depth(key), unblocks: count(key) });
}

/**
 * Split candidate issues into the ready frontier and the issues that must wait.
 *
 * @param {string[]} candidateUrls - open issues hive would otherwise queue, in hive's order
 * @param {Map<string, object>} relations - from createIssueRelationsFetcher
 * @param {object} [options]
 * @param {boolean} [options.inheritParentBlockers=true]
 * @returns {{ready: Array<{url: string, criticalPath: number, unblocks: number}>, waiting: Array<{url: string, reasons: Array<object>}>, unknown: string[], cycles: string[][]}}
 */
export function planIssueQueue(candidateUrls, relations, options = {}) {
  const waitGraph = buildWaitGraph(relations, options);
  const scoreOf = computeUnblockScores(waitGraph);
  const ready = [];
  const waiting = [];
  const unknown = [];
  candidateUrls.forEach((url, order) => {
    const ref = parseIssueRef(url);
    const relation = ref && relations.get(ref.key);
    if (!relation) {
      // No relation data (not a GitHub issue URL, or the query failed for it): never block on
      // missing information — that is how hive behaved before relations were respected.
      unknown.push(url);
      ready.push({ url, order, criticalPath: 0, unblocks: 0 });
      return;
    }
    const reasons = getWaitReasons(relation, relations, options);
    if (reasons.length > 0) waiting.push({ url, reasons });
    else ready.push({ url, order, ...scoreOf(relation.key) });
  });
  ready.sort((a, b) => b.criticalPath - a.criticalPath || b.unblocks - a.unblocks || a.order - b.order);
  const cycles = findWaitCycles(waitGraph);
  return { ready: ready.map(({ order: _order, ...rest }) => rest), waiting, unknown, cycles };
}

/** Human-readable explanation of why an issue waits. */
export function describeWaitReasons(url, reasons) {
  const refs = list => list.map(ref => formatIssueRef(ref.url, url)).join(', ');
  return reasons
    .map(reason => {
      if (reason.type === 'blocked-by') return `blocked by ${refs(reason.refs)}`;
      if (reason.type === 'open-sub-issues') return `${reason.refs.length} open sub-issue${reason.refs.length === 1 ? '' : 's'} (${refs(reason.refs)})`;
      if (reason.type === 'ancestor-blocked-by') return `parent ${formatIssueRef(reason.ancestor.url, url)} is blocked by ${refs(reason.refs)}`;
      return reason.type;
    })
    .join('; ');
}

/**
 * The stateful gate hive.mjs uses: filter + order the issues a polling iteration found, recheck
 * a single issue right before a worker starts it, and tell --once runs whether another round
 * can make progress.
 *
 * @param {object} deps
 * @param {boolean} deps.enabled - --respect-issue-relations
 * @param {(urls: string[]) => Promise<Map<string, object>>} deps.fetchIssueRelations
 * @param {Function} deps.log
 * @param {Function} [deps.cleanErrorMessage]
 */
export function createIssueRelationsGate({ enabled, fetchIssueRelations, log, cleanErrorMessage = error => error?.message || String(error) }) {
  let waitingCount = 0;
  let completedAtLastRound = null;

  async function filterReadyIssues(issues) {
    waitingCount = 0;
    if (!enabled || !Array.isArray(issues) || issues.length === 0) return issues;
    await log('   🔗 Checking sub-issue and dependency (blocked by) relations...');
    let relations;
    try {
      relations = await fetchIssueRelations(issues.map(issue => issue.url));
    } catch (error) {
      await log(`   ⚠️  Could not read issue relations (${cleanErrorMessage(error)}); queueing issues without relation ordering`, { level: 'warning' });
      return issues;
    }
    const plan = planIssueQueue(
      issues.map(issue => issue.url),
      relations
    );
    waitingCount = plan.waiting.length;
    for (const cycle of plan.cycles) {
      await log(`   ⚠️  Dependency cycle, these issues can never become ready until it is broken: ${cycle.join(' → ')}`, { level: 'warning' });
    }
    for (const entry of plan.waiting) {
      await log(`      ⏳ Waiting (${describeWaitReasons(entry.url, entry.reasons)}): ${entry.url}`);
    }
    for (const entry of plan.ready) {
      if (entry.unblocks > 0) await log(`      🚦 Ready, unblocks ${entry.unblocks} issue(s) (critical path ${entry.criticalPath}): ${entry.url}`, { verbose: true });
    }
    await log(`   🔗 Relations: ${plan.ready.length} ready (no open blockers or sub-issues), ${plan.waiting.length} waiting${plan.unknown.length ? `, ${plan.unknown.length} without relation data` : ''}`);
    const byUrl = new Map(issues.map(issue => [issue.url, issue]));
    return plan.ready.map(entry => byUrl.get(entry.url)).filter(Boolean);
  }

  /** Right before a worker starts: relations may have changed since the issue was queued. */
  async function checkIssueReady(issueUrl) {
    if (!enabled || !parseIssueRef(issueUrl)) return { ready: true };
    try {
      const relations = await fetchIssueRelations([issueUrl]);
      const relation = relations.get(parseIssueRef(issueUrl).key);
      if (!relation) return { ready: true };
      const reasons = getWaitReasons(relation, relations);
      return reasons.length === 0 ? { ready: true } : { ready: false, reason: describeWaitReasons(issueUrl, reasons) };
    } catch (error) {
      await log(`      ⚠️  Could not recheck issue relations: ${cleanErrorMessage(error)}`, { verbose: true });
      return { ready: true };
    }
  }

  /**
   * --once: after the queue drains, poll once more if issues were waiting and work completed
   * since the last round — with --auto-merge that merge has just unblocked the next issues.
   */
  function shouldStartAnotherOnceRound(completedCount, deferredCount = 0) {
    const previous = completedAtLastRound ?? 0;
    completedAtLastRound = completedCount;
    return enabled && waitingCount + deferredCount > 0 && completedCount > previous;
  }

  return { filterReadyIssues, checkIssueReady, shouldStartAnotherOnceRound, getWaitingCount: () => waitingCount };
}
