/**
 * A finite in-memory GitHub for the post-merge closing tests (issues #3354 to #3359).
 * `run(args)` answers the `gh` calls the closing code makes; unknown calls fail.
 *
 * State (JSON-serializable, so the gh executable next to this file can use it):
 * - repos: { "owner/repo": { default_branch } }
 * - prs: { "owner/repo#N": { body, base, head, merged, merge_commit_sha, created_at, merged_at, linked: [keys] } }
 *   (`linked` is GitHub's closingIssuesReferences, which GitHub closes on a default-branch merge)
 * - issues: { "owner/repo#N": { state, state_reason, body, created_at, closed_at, sub: [keys], parent, blockedBy: [keys],
 *   reopened: [{ login, type, at }], comments: [{ id, body }], closesAfterSleeps } }
 *   (`closesAfterSleeps`: GitHub closes the issue itself after that many polling waits)
 */
const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const fail = message => ({ code: 1, stdout: '', stderr: message });
const split = key => {
  const [slug, number] = key.split('#');
  const [owner, repo] = slug.split('/');
  return { owner, repo, number: Number(number) };
};

export function createFakeGitHub(state) {
  state.repos ||= {};
  state.prs ||= {};
  state.issues ||= {};
  state.search ||= [];
  const calls = [];
  const issue = key => state.issues[key.toLowerCase()];
  const option = (args, name) => args[args.indexOf(name) + 1];
  const field = (args, name) => {
    const entry = args.find(arg => arg.startsWith(`${name}=`));
    return entry && entry.slice(name.length + 1);
  };
  const issueJson = key => {
    const value = issue(key);
    const { number } = split(key);
    return { number, title: `Issue ${number}`, state: value.state, state_reason: value.state_reason || null, body: value.body ?? '', created_at: value.created_at || '2026-01-01T00:00:00Z', closed_at: value.closed_at || null, html_url: `https://github.com/${key.split('#')[0]}/issues/${number}` };
  };
  const node = key => {
    const value = issue(key);
    const { number } = split(key);
    return { number, state: value.state.toUpperCase(), stateReason: value.state_reason ? value.state_reason.toUpperCase() : null, closedAt: value.closed_at || null, repository: { nameWithOwner: key.split('#')[0] } };
  };
  const parentChain = key => {
    const parent = issue(key)?.parent;
    return parent ? { number: split(parent).number, repository: { nameWithOwner: parent.split('#')[0] }, parent: parentChain(parent) } : null;
  };
  const close = (key, reason = 'completed') => Object.assign(issue(key), { state: 'closed', state_reason: reason, closed_at: new Date().toISOString() });
  const graphql = args => {
    const query = field(args, 'query') || '';
    const key = `${field(args, 'owner')}/${field(args, 'repo')}#${field(args, 'number')}`.toLowerCase();
    if (query.includes('closingIssuesReferences')) {
      const nodes = (state.prs[key]?.linked || []).map(linked => ({ number: split(linked).number, repository: { nameWithOwner: linked.split('#')[0] } }));
      return json([{ data: { repository: { pullRequest: { closingIssuesReferences: { nodes, pageInfo: { hasNextPage: false } } } } } }]);
    }
    if (query.includes('closedByPullRequestsReferences')) {
      const aliases = [...query.matchAll(/(i\d+): issue/g)].map(match => match[1]);
      return json({ data: { repository: Object.fromEntries(aliases.map(alias => [alias, { closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [] } }])) } });
    }
    if (!issue(key)) return json({ data: { repository: { issue: null } } });
    if (query.includes('subIssues(first:100)')) {
      const value = issue(key);
      const subs = (value.sub || []).map(node);
      const blockers = (value.blockedBy || []).map(node);
      return json({ data: { repository: { issue: { ...node(key), body: value.body ?? '', parent: parentChain(key) && { number: parentChain(key).number, repository: parentChain(key).repository }, subIssues: { totalCount: subs.length, nodes: subs }, blockedBy: { totalCount: blockers.length, nodes: blockers }, timelineItems: { nodes: (value.reopened || []).map(event => ({ createdAt: event.at, actor: { __typename: event.type || 'User', login: event.login } })) }, comments: { nodes: (value.comments || []).map(comment => ({ databaseId: comment.id, body: comment.body })) } } } } });
    }
    return json({ data: { repository: { issue: { parent: parentChain(key) } } } });
  };
  const api = args => {
    if (args[1] === '-X' && args[2] === 'PATCH') {
      const [, slug, id] = args[3].match(/^repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/);
      const owner = Object.keys(state.issues).find(key => key.startsWith(`${slug}#`) && issue(key).comments?.some(comment => comment.id === Number(id)));
      if (!owner) return fail('HTTP 404');
      issue(owner).comments.find(comment => comment.id === Number(id)).body = field(args, 'body');
      return json({});
    }
    if (args[1] === '-X' && args[2] === 'GET' && args[3] === 'search/issues') {
      const query = field(args, 'q');
      return json({ total_count: state.search.length, incomplete_results: false, items: state.search.filter(item => !item.query || query.includes(item.query)).map(item => ({ number: item.number, repository_url: `https://api.github.com/repos/${item.repo}`, pull_request: { merged_at: item.merged_at, html_url: `https://github.com/${item.repo}/pull/${item.number}` } })) });
    }
    if (args[1] === 'graphql') return graphql(args);
    const endpoint = args[1];
    // Issue #2406: the requirements report check reads the conversation; this fixture has none.
    if (/^repos\/[^/]+\/[^/]+\/(issues|pulls)\/\d+\/(comments|reviews)$/.test(endpoint)) return json([[]]);
    let match = endpoint.match(/^repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/);
    if (match) {
      const key = `${match[1]}/${match[2]}#${match[3]}`.toLowerCase();
      const pr = state.prs[key];
      if (!pr) return fail('HTTP 404');
      return json({ number: Number(match[3]), body: pr.body, head: { sha: pr.head_sha || 'a'.repeat(40), ref: pr.head || 'feature' }, base: { ref: pr.base || 'main' }, merged: Boolean(pr.merged), merged_at: pr.merged ? pr.merged_at || '2026-10-15T00:00:00Z' : null, merge_commit_sha: pr.merged ? pr.merge_commit_sha || 'b'.repeat(40) : null, created_at: pr.created_at || '2026-01-02T00:00:00Z', html_url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` });
    }
    match = endpoint.match(/^repos\/([^/]+)\/([^/]+)\/issues\/(\d+)(\/sub_issues|\/timeline)?$/);
    if (match) {
      const key = `${match[1]}/${match[2]}#${match[3]}`.toLowerCase();
      if (!issue(key)) return fail('HTTP 404');
      if (match[4] === '/sub_issues') return json([(issue(key).sub || []).map(sub => ({ number: split(sub).number, repository_url: `https://api.github.com/repos/${sub.split('#')[0]}` }))]);
      if (match[4] === '/timeline') return json([[]]);
      return json(issueJson(key));
    }
    match = endpoint.match(/^repos\/([^/]+\/[^/]+)$/);
    if (match && state.repos[match[1].toLowerCase()]) return json(state.repos[match[1].toLowerCase()]);
    return fail(`Unexpected fake gh api call: ${endpoint}`);
  };
  const run = async args => {
    calls.push(args);
    if (args[0] === 'api') return api(args);
    if (args[0] === 'issue' && (args[1] === 'close' || args[1] === 'comment')) {
      const key = `${option(args, '--repo')}#${args[2]}`.toLowerCase();
      if (!issue(key)) return fail('HTTP 404');
      if (state.failClose?.includes(key) && args[1] === 'close') return fail('HTTP 403: Resource not accessible by integration');
      const value = issue(key);
      value.comments ||= [];
      value.comments.push({ id: 1000 + value.comments.length + Object.keys(state.issues).indexOf(key) * 100, body: option(args, args[1] === 'close' ? '--comment' : '--body') });
      if (args[1] === 'close') close(key, option(args, '--reason') === 'not planned' ? 'not_planned' : 'completed');
      return json({});
    }
    if (args[0] === 'pr' && args[1] === 'merge') {
      const key = `${option(args, '--repo') || state.defaultRepo}#${args[2]}`.toLowerCase();
      const pr = state.prs[key];
      if (!pr) return fail('HTTP 404');
      pr.merged = true;
      if ((pr.base || 'main') === state.repos[key.split('#')[0]]?.default_branch) for (const linked of pr.linked || []) if (!issue(linked)?.closesAfterSleeps) close(linked);
      return { code: 0, stdout: 'merged', stderr: '' };
    }
    return fail(`Unexpected fake gh call: ${args.join(' ')}`);
  };
  /** One polling wait passes: GitHub closes the issues it was going to close. */
  const sleep = async () => {
    for (const [key, value] of Object.entries(state.issues)) {
      if (!value.closesAfterSleeps || value.state !== 'open') continue;
      value.closesAfterSleeps -= 1;
      if (value.closesAfterSleeps === 0) close(key);
    }
  };
  const closeCalls = () => calls.filter(args => args[0] === 'issue' && args[1] === 'close').map(args => `${option(args, '--repo')}#${args[2]}`.toLowerCase());
  return { state, calls, run, sleep, closeCalls, issue };
}
