#!/usr/bin/env node
/**
 * Issue #2239 — "Links to images were broken".
 *
 * Reproduces the exact defect reported in the issue: on the fork PR
 * https://github.com/Godmy/frontend/pull/2 the description embedded
 *
 *   <img src="https://github.com/Godmy/frontend/blob/issue-1-46ba053c/docs/screenshots/graph-force.png?raw=true" width="260">
 *
 * The branch `issue-1-46ba053c` only ever existed in the fork
 * `konard/Godmy-frontend`, so all three screenshots rendered as broken images.
 * Verified against the live API while investigating:
 *   repos/Godmy/frontend/contents/docs/screenshots/graph-force.png?ref=issue-1-46ba053c → 404
 *   repos/konard/Godmy-frontend/contents/docs/screenshots/graph-force.png?ref=issue-1-46ba053c → 200
 *
 * The repair must rewrite those links to the head repository, and must leave
 * every link it cannot prove broken exactly as the author wrote it.
 *
 * @hive-mind-test-suite default
 */

import { splitRefAndPath, extractGitHubFileLinks, rewriteLinkRepository, planLinkRepairs, repairPullRequestBodyLinks, repairPullRequestCommentLinks, runPullRequestLinkRepair } from '../src/pr-image-link-repair.lib.mjs';

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) throw new Error(message || 'assertion failed');
};

const run = async (name, fn) => {
  process.stdout.write(`Testing ${name}... `);
  try {
    await fn();
    console.log('PASSED');
    passed++;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    failed++;
  }
};

const BASE_REPO = 'Godmy/frontend';
const HEAD_REPO = 'konard/Godmy-frontend'; // the log names it konard/frontend; that is a rename alias GitHub still redirects
const BRANCH = 'issue-1-46ba053c';
const SHOTS = ['graph-force.png', 'graph-sankey.png', 'graph-network.png'];

/** The description as the AI tool actually published it on Godmy/frontend#2. */
const brokenBody = ['## Summary', '', 'Adds three graph visualizations.', '', '<p align="center">', ...SHOTS.map(shot => `  <img src="https://github.com/${BASE_REPO}/blob/${BRANCH}/docs/screenshots/${shot}?raw=true" width="260">`), '</p>', '', `Markdown form too: ![force](https://github.com/${BASE_REPO}/blob/${BRANCH}/docs/screenshots/${SHOTS[0]}?raw=true)`, '', `Related: https://github.com/${BASE_REPO}/blob/main/README.md`].join('\n');

/**
 * Existence oracle matching the live repositories at the time of the report:
 * the screenshots live only in the fork, `README.md` on `main` lives in both.
 */
const realWorldPathExists = async ({ owner, repo, ref, path }) => {
  const full = `${owner}/${repo}`;
  if (path === 'README.md' && ref === 'main') return true;
  if (!path.startsWith('docs/screenshots/')) return false;
  if (ref !== BRANCH) return false;
  return full === HEAD_REPO;
};

const makeFakeDollar = scripted => {
  const calls = [];
  const dispatch = (rawArgs, values, lastOptions) => {
    const raw = String.raw({ raw: rawArgs }, ...values.map(v => String(v)));
    calls.push({ raw, options: lastOptions });
    const handler = scripted.find(s => s.match.test(raw));
    if (!handler) return Promise.resolve({ code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });
    return Promise.resolve(typeof handler.respond === 'function' ? handler.respond({ raw, options: lastOptions }) : handler.respond);
  };
  const $ = (...firstArgs) => {
    if (Array.isArray(firstArgs[0]) && firstArgs[0].raw) return dispatch(firstArgs[0].raw, firstArgs.slice(1), {});
    const options = firstArgs[0] || {};
    return (rawArgs, ...values) => dispatch(rawArgs.raw, values, options);
  };
  $.calls = calls;
  return $;
};

const prPayload = {
  body: brokenBody,
  head: { ref: BRANCH, sha: 'a'.repeat(40), repo: { full_name: HEAD_REPO } },
  base: { ref: 'main' },
};

await run('splitRefAndPath keeps multi-segment refs together', async () => {
  assert(splitRefAndPath(`${BRANCH}/docs/screenshots/a.png?raw=true`, [BRANCH]).path === 'docs/screenshots/a.png');
  assert(splitRefAndPath(`${BRANCH}/docs/screenshots/a.png?raw=true`, [BRANCH]).suffix === '?raw=true');
  const release = splitRefAndPath('release/2.0/docs/a.png', ['release/2.0', 'main']);
  assert(release.ref === 'release/2.0', `expected release/2.0, got ${release.ref}`);
  assert(release.path === 'docs/a.png', `expected docs/a.png, got ${release.path}`);
  const raw = splitRefAndPath('refs/heads/feature/x/docs/a.png', ['feature/x']);
  assert(raw.refPrefix === 'refs/heads/' && raw.ref === 'feature/x' && raw.path === 'docs/a.png');
  // Unknown ref: first segment wins, which is right for a commit SHA.
  assert(splitRefAndPath('deadbeef/docs/a.png', []).ref === 'deadbeef');
});

await run('extractGitHubFileLinks finds both HTML and Markdown embeds', async () => {
  const links = extractGitHubFileLinks(brokenBody, { refCandidates: [BRANCH, 'main'] });
  // 3 screenshots + README (the markdown embed repeats the first screenshot URL)
  assert(links.length === 4, `expected 4 distinct links, got ${links.length}`);
  const force = links.find(l => l.path.endsWith(SHOTS[0]));
  assert(force.occurrences === 2, `expected the HTML and Markdown occurrences to be merged, got ${force.occurrences}`);
  assert(force.owner === 'Godmy' && force.repo === 'frontend' && force.ref === BRANCH);
  assert(force.isImage === true);
  assert(links.find(l => l.path === 'README.md').isImage === false);
});

await run('rewriteLinkRepository preserves ref, path and ?raw=true', async () => {
  const [link] = extractGitHubFileLinks(`https://github.com/${BASE_REPO}/blob/${BRANCH}/docs/screenshots/x.png?raw=true`, { refCandidates: [BRANCH] });
  assert(rewriteLinkRepository(link, 'konard', 'Godmy-frontend') === `https://github.com/${HEAD_REPO}/blob/${BRANCH}/docs/screenshots/x.png?raw=true`);
});

await run('planLinkRepairs repoints the broken fork screenshots (issue #2239 reproduction)', async () => {
  const plan = await planLinkRepairs({ body: brokenBody, headRepo: HEAD_REPO, refCandidates: [BRANCH, 'main'], pathExists: realWorldPathExists });
  assert(plan.changed, 'the broken body must be repaired');
  assert(plan.repairs.length === 3, `expected 3 repaired links, got ${plan.repairs.length}`);
  for (const shot of SHOTS) {
    assert(plan.body.includes(`https://github.com/${HEAD_REPO}/blob/${BRANCH}/docs/screenshots/${shot}?raw=true`), `${shot} must point at the fork`);
    assert(!plan.body.includes(`https://github.com/${BASE_REPO}/blob/${BRANCH}/docs/screenshots/${shot}`), `${shot} must no longer point at the base repo`);
  }
  // Both occurrences of the repeated URL are rewritten.
  assert(!plan.body.includes(`(https://github.com/${BASE_REPO}/blob/${BRANCH}`), 'the Markdown embed must be repaired too');
  // A link that resolves as written is never touched.
  assert(plan.body.includes(`https://github.com/${BASE_REPO}/blob/main/README.md`), 'working links must be left alone');
});

await run('planLinkRepairs is idempotent', async () => {
  const first = await planLinkRepairs({ body: brokenBody, headRepo: HEAD_REPO, refCandidates: [BRANCH, 'main'], pathExists: realWorldPathExists });
  const second = await planLinkRepairs({ body: first.body, headRepo: HEAD_REPO, refCandidates: [BRANCH, 'main'], pathExists: realWorldPathExists });
  assert(second.changed === false, 'a repaired body must not be repaired again');
  assert(second.repairs.length === 0);
});

await run('planLinkRepairs leaves links alone when existence cannot be determined', async () => {
  const plan = await planLinkRepairs({ body: brokenBody, headRepo: HEAD_REPO, refCandidates: [BRANCH], pathExists: async () => null });
  assert(plan.changed === false, 'unknown existence must never trigger a rewrite');
  assert(plan.skipped.length === 4, `expected every link recorded as skipped, got ${plan.skipped.length}`);
  assert(plan.skipped.every(s => s.reason === 'existence-unknown'));
});

await run('planLinkRepairs leaves links alone when the head repo does not have the file either', async () => {
  const plan = await planLinkRepairs({ body: brokenBody, headRepo: HEAD_REPO, refCandidates: [BRANCH], pathExists: async () => false });
  assert(plan.changed === false, 'a file missing from both repositories is an authoring mistake, not a fork-path mistake');
  assert(plan.skipped.some(s => s.reason === 'missing-in-head-repo'));
});

await run('planLinkRepairs is a no-op for a same-repo (non-fork) pull request', async () => {
  const sameRepoBody = brokenBody.split(BASE_REPO).join(HEAD_REPO);
  const plan = await planLinkRepairs({ body: sameRepoBody, headRepo: HEAD_REPO, refCandidates: [BRANCH], pathExists: realWorldPathExists });
  assert(plan.changed === false, 'links already pointing at the head repo must not be probed or rewritten');
  assert(plan.repairs.length === 0);
});

await run('planLinkRepairs repairs raw.githubusercontent.com links', async () => {
  const body = `![shot](https://raw.githubusercontent.com/${BASE_REPO}/refs/heads/${BRANCH}/docs/screenshots/${SHOTS[0]})`;
  const plan = await planLinkRepairs({ body, headRepo: HEAD_REPO, refCandidates: [BRANCH], pathExists: realWorldPathExists });
  assert(plan.changed, 'raw.githubusercontent.com links break in exactly the same way');
  assert(plan.body.includes(`https://raw.githubusercontent.com/${HEAD_REPO}/refs/heads/${BRANCH}/docs/screenshots/${SHOTS[0]}`), plan.body);
});

await run('repairPullRequestBodyLinks PATCHes the description with the repaired body', async () => {
  const $ = makeFakeDollar([
    { match: /repos\/Godmy\/frontend\/pulls\/2$/, respond: { code: 0, stdout: JSON.stringify(prPayload), stderr: '' } },
    { match: /repos\/konard\/Godmy-frontend\/contents\/docs\/screenshots\/[\w.-]+\?ref=/, respond: { code: 0, stdout: 'abc123\n', stderr: '' } },
    { match: /repos\/Godmy\/frontend\/contents\/README\.md\?ref=main/, respond: { code: 0, stdout: 'def456\n', stderr: '' } },
    { match: /pulls\/2 -X PATCH --input -/, respond: { code: 0, stdout: '{}', stderr: '' } },
  ]);
  const stats = await repairPullRequestBodyLinks({ $, owner: 'Godmy', repo: 'frontend', prNumber: 2 });
  assert(stats.errors === 0, `unexpected errors: ${stats.errors}`);
  assert(stats.repairs.length === 3, `expected 3 repairs, got ${stats.repairs.length}`);
  assert(stats.repaired === 4, `expected 4 repaired occurrences, got ${stats.repaired}`);
  assert(stats.edited === 1, 'the description must be edited');
  const edit = $.calls.find(c => /pulls\/2 -X PATCH/.test(c.raw));
  const sent = JSON.parse(edit.options.stdin).body;
  assert(sent.includes(`https://github.com/${HEAD_REPO}/blob/${BRANCH}/docs/screenshots/graph-force.png?raw=true`));
  assert(!sent.includes(`https://github.com/${BASE_REPO}/blob/${BRANCH}/`));
});

await run('repairPullRequestBodyLinks probes each distinct path once', async () => {
  const $ = makeFakeDollar([
    { match: /repos\/Godmy\/frontend\/pulls\/2$/, respond: { code: 0, stdout: JSON.stringify(prPayload), stderr: '' } },
    { match: /repos\/konard\/Godmy-frontend\/contents\/docs\/screenshots\/[\w.-]+\?ref=/, respond: { code: 0, stdout: 'abc123\n', stderr: '' } },
    { match: /repos\/Godmy\/frontend\/contents\/README\.md\?ref=main/, respond: { code: 0, stdout: 'def456\n', stderr: '' } },
    { match: /pulls\/2 -X PATCH --input -/, respond: { code: 0, stdout: '{}', stderr: '' } },
  ]);
  await repairPullRequestBodyLinks({ $, owner: 'Godmy', repo: 'frontend', prNumber: 2 });
  const contentCalls = $.calls.filter(c => /\/contents\//.test(c.raw));
  // 3 screenshots probed in the base repo (404) + 3 in the fork + README once.
  assert(contentCalls.length === 7, `expected 7 content probes, got ${contentCalls.length}: ${contentCalls.map(c => c.raw).join(' | ')}`);
});

await run('repairPullRequestBodyLinks does not edit in dryRun mode', async () => {
  const $ = makeFakeDollar([
    { match: /repos\/Godmy\/frontend\/pulls\/2$/, respond: { code: 0, stdout: JSON.stringify(prPayload), stderr: '' } },
    { match: /repos\/konard\/Godmy-frontend\/contents\//, respond: { code: 0, stdout: 'abc123\n', stderr: '' } },
    { match: /repos\/Godmy\/frontend\/contents\/README\.md\?ref=main/, respond: { code: 0, stdout: 'def456\n', stderr: '' } },
  ]);
  const stats = await repairPullRequestBodyLinks({ $, owner: 'Godmy', repo: 'frontend', prNumber: 2, dryRun: true });
  assert(stats.repairs.length === 3);
  assert(stats.edited === 0, 'dryRun must not edit');
  assert(!$.calls.some(c => /PATCH/.test(c.raw)), 'dryRun must not call PATCH');
});

await run('repairPullRequestCommentLinks only edits comments the bot authored', async () => {
  const comments = [
    { id: 11, user: { login: 'bot-user' }, body: `<img src="https://github.com/${BASE_REPO}/blob/${BRANCH}/docs/screenshots/${SHOTS[0]}?raw=true">` },
    { id: 12, user: { login: 'a-human' }, body: `<img src="https://github.com/${BASE_REPO}/blob/${BRANCH}/docs/screenshots/${SHOTS[1]}?raw=true">` },
  ];
  const $ = makeFakeDollar([
    { match: /repos\/Godmy\/frontend\/pulls\/2$/, respond: { code: 0, stdout: JSON.stringify(prPayload), stderr: '' } },
    { match: /issues\/2\/comments --paginate/, respond: { code: 0, stdout: JSON.stringify(comments), stderr: '' } },
    { match: /repos\/konard\/Godmy-frontend\/contents\//, respond: { code: 0, stdout: 'abc123\n', stderr: '' } },
    { match: /issues\/comments\/11 -X PATCH --input -/, respond: { code: 0, stdout: '{}', stderr: '' } },
  ]);
  const stats = await repairPullRequestCommentLinks({ $, owner: 'Godmy', repo: 'frontend', prNumber: 2, botLogin: 'bot-user' });
  assert(stats.edited === 1, `expected exactly one edited comment, got ${stats.edited}`);
  assert(!$.calls.some(c => /issues\/comments\/12/.test(c.raw)), "a human's comment must never be edited");
  const edit = $.calls.find(c => /issues\/comments\/11 -X PATCH/.test(c.raw));
  assert(JSON.parse(edit.options.stdin).body.includes(`https://github.com/${HEAD_REPO}/blob/${BRANCH}/`));
});

await run('runPullRequestLinkRepair reports the combined totals', async () => {
  const comments = [{ id: 11, user: { login: 'bot-user' }, body: `![s](https://github.com/${BASE_REPO}/blob/${BRANCH}/docs/screenshots/${SHOTS[1]}?raw=true)` }];
  const $ = makeFakeDollar([
    { match: /repos\/Godmy\/frontend\/pulls\/2$/, respond: { code: 0, stdout: JSON.stringify(prPayload), stderr: '' } },
    { match: /gh api user --jq \.login/, respond: { code: 0, stdout: 'bot-user\n', stderr: '' } },
    { match: /issues\/2\/comments --paginate/, respond: { code: 0, stdout: JSON.stringify(comments), stderr: '' } },
    { match: /repos\/konard\/Godmy-frontend\/contents\//, respond: { code: 0, stdout: 'abc123\n', stderr: '' } },
    { match: /repos\/Godmy\/frontend\/contents\/README\.md\?ref=main/, respond: { code: 0, stdout: 'def456\n', stderr: '' } },
    { match: /-X PATCH --input -/, respond: { code: 0, stdout: '{}', stderr: '' } },
  ]);
  const result = await runPullRequestLinkRepair({ $, owner: 'Godmy', repo: 'frontend', prNumber: 2 });
  assert(result.totalRepaired === 5, `expected 4 body + 1 comment occurrences, got ${result.totalRepaired}`);
  assert(result.totalEdited === 2, `expected the description and one comment edited, got ${result.totalEdited}`);
});

await run('runPullRequestLinkRepair is inert without owner/repo/prNumber', async () => {
  const $ = makeFakeDollar([]);
  const result = await runPullRequestLinkRepair({ $, owner: 'Godmy', repo: 'frontend', prNumber: null });
  assert(result.totalEdited === 0 && $.calls.length === 0, 'nothing should be requested');
});

await run('an unreachable GitHub API never rewrites anything', async () => {
  const $ = makeFakeDollar([
    { match: /repos\/Godmy\/frontend\/pulls\/2$/, respond: { code: 0, stdout: JSON.stringify(prPayload), stderr: '' } },
    { match: /\/contents\//, respond: { code: 1, stdout: '', stderr: 'error connecting to api.github.com' } },
  ]);
  const stats = await repairPullRequestBodyLinks({ $, owner: 'Godmy', repo: 'frontend', prNumber: 2 });
  assert(stats.edited === 0, 'a network failure must not be read as "the file is missing"');
  assert(stats.repairs.length === 0);
  assert(stats.skipped.every(s => s.reason === 'existence-unknown'));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
