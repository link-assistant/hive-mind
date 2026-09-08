#!/usr/bin/env node
/**
 * Regression test for Formal AI commit attribution (issue #2229).
 *
 * The requirement is not "the trailers exist somewhere", it is that
 * formal-ai's `scripts/self-hosting-metric.rs` can attribute the commit: the
 * four trailers and an evidence directory that resolves **in the same commit's
 * tree**, naming formal-ai and recording the session id. A commit that carries
 * only half of that is worse than an unattributed one — the metric treats it as
 * a hard error and the release gate fails.
 *
 * So the assertions are behavioural throughout: real repositories, real commits
 * made with real git, and the tree of the resulting commit is read back with
 * `git show <sha>:<path>` exactly as the metric reads it. The malformed shapes
 * are tested as carefully as the good one, because the ways this can go wrong
 * (`--no-verify`, merges, a missing staging directory) are all cases where git
 * runs some hooks and not others.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2229
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAttributionGitEnv, buildAttributionTrailers, buildEvidenceDirectory, buildModelTrailerValue, buildSessionEvidence, collectModelIdentities, createFormalAiAttributionSession, detectHostedModel, ensureEvidenceExcluded, isCanonicalPullRequestUrl, parseCommitTrailers, parseGitConfigEnv, validateEvidencePath, FORMAL_AI_TRAILER_KEYS } from '../src/formal-ai-attribution.lib.mjs';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}

function fail(label, expected, actual) {
  console.error(`  FAIL: ${label}`);
  if (expected !== undefined) console.error(`     expected: ${JSON.stringify(expected)}`);
  if (actual !== undefined) console.error(`     actual:   ${JSON.stringify(actual)}`);
  failed++;
}

function assertEqual(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(label, expected, actual);
}

const VERSION = '0.345.0';
const SESSION = 'ses_7f3c2b19';
const ISSUE = 2229;
const EVIDENCE = `dev/log/self-authored/issue-${ISSUE}/evidence`;
const PR_URL = 'https://github.com/link-assistant/hive-mind/pull/2230';

console.log('\n=== issue #2229: the trailer block the metric reads ===');

assertEqual(buildEvidenceDirectory({ issueNumber: ISSUE }), EVIDENCE, "the evidence directory is the one formal-ai's own workflow uses");
assertEqual(buildEvidenceDirectory({ prNumber: 7 }), 'dev/log/self-authored/pull-7/evidence', 'a run without an issue number still has a home');
assertEqual(buildSessionEvidence({ sessionId: SESSION, version: VERSION }), `formal-ai session ${SESSION}\nformal-ai model formal-ai/${VERSION}\n`, 'session-id.txt records the session and the model, as the issue specifies');
assertEqual(buildModelTrailerValue(VERSION), 'formal-ai/0.345.0', 'the model is reported as formal-ai/<version>');

const complete = buildAttributionTrailers({ sessionId: SESSION, version: VERSION, evidencePath: EVIDENCE, prUrl: PR_URL });
assertEqual(complete.errors.length, 0, 'a complete run produces no complaints');
assertEqual(complete.trailers.join('\n'), [`${FORMAL_AI_TRAILER_KEYS.session}: ${SESSION}`, `${FORMAL_AI_TRAILER_KEYS.model}: formal-ai/${VERSION}`, `${FORMAL_AI_TRAILER_KEYS.evidence}: ${EVIDENCE}`, `${FORMAL_AI_TRAILER_KEYS.pullRequest}: ${PR_URL}`].join('\n'), 'and all four trailers');

assertEqual(buildAttributionTrailers({ version: VERSION, evidencePath: EVIDENCE }).errors[0], 'no Agent CLI session id was observed', 'without a session id there are no trailers at all, rather than half of them');
assertEqual(buildAttributionTrailers({ sessionId: SESSION, evidencePath: EVIDENCE }).trailers.length, 0, 'and the same without a version');

// The metric rejects these paths outright, so they must never be written.
assertEqual(validateEvidencePath('dev/log/a:b').valid, false, "an evidence path containing ':' is refused");
assertEqual(validateEvidencePath('/etc/passwd').valid, false, 'an absolute evidence path is refused');
assertEqual(validateEvidencePath('dev/../../etc').valid, false, 'a path escaping the repository is refused');
assertEqual(validateEvidencePath(EVIDENCE).valid, true, 'and the real one is accepted');

assertEqual(isCanonicalPullRequestUrl(PR_URL), true, 'the canonical pull request URL is recognised');
assertEqual(isCanonicalPullRequestUrl(`${PR_URL}/files`), false, 'a deep link into the pull request is not canonical');
assertEqual(isCanonicalPullRequestUrl('https://github.com/link-assistant/hive-mind/issues/2229'), false, 'and neither is the issue');

// git interpret-trailers --parse only reads the last paragraph; the metric reads
// the whole body, so the parser used for verification has to as well.
const splitBody = ['fix: something', '', `${FORMAL_AI_TRAILER_KEYS.session}: ${SESSION}`, '', 'Co-authored-by: Someone <someone@example.com>', '    Indented-Trailer: not a trailer'].join('\n');
const parsedSplit = parseCommitTrailers(splitBody);
assertEqual((parsedSplit['formal-ai-session'] || [])[0], SESSION, 'a trailer separated from the last paragraph is still found');
assertEqual(parsedSplit['indented-trailer'], undefined, 'an indented line is not a trailer');

console.log('\n=== issue #2229: a hosted model is rejected with the reason ===');

assertEqual(detectHostedModel('anthropic/claude-sonnet-4-5'), 'claude', 'a Claude model is recognised');
assertEqual(detectHostedModel('openai/gpt-5-codex'), 'codex', 'a Codex model is recognised');
assertEqual(detectHostedModel('google/gemini-2.5-pro'), 'gemini', 'a Gemini model is recognised');
assertEqual(detectHostedModel('opencode/grok-code'), 'opencode', 'an OpenCode model is recognised');
assertEqual(detectHostedModel('formalai/formal-ai'), null, 'and formal-ai itself is not');
assertEqual(detectHostedModel(`${SESSION}`), null, 'an ordinary session id names no hosted model');

assertEqual(collectModelIdentities({ type: 'log', message: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' } }).join(','), 'anthropic,claude-sonnet-4-5', 'provider and model identifiers are read out of a stream record');
assertEqual(collectModelIdentities({ type: 'text', text: 'I asked Claude about it' }).length, 0, 'free text is not treated as an identity claim');

console.log('\n=== issue #2229: the hooks reach the agent and nothing else ===');

assertEqual(
  parseGitConfigEnv(buildAttributionGitEnv({ env: {}, hooksPath: '/tmp/hooks' }))
    .map(pair => pair.join('='))
    .join(';'),
  'core.hooksPath=/tmp/hooks',
  'the hooks are delivered as environment config, which outranks every config file'
);
const routedEnv = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/home/box/.hive-mind/git-hooks', GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'Box' };
const merged = parseGitConfigEnv(buildAttributionGitEnv({ env: routedEnv, hooksPath: '/tmp/hooks' }));
assertEqual(merged.length, 2, "a routed task's existing config is preserved, not appended to");
assertEqual(merged.find(([key]) => key === 'user.name')?.[1], 'Box', 'including entries we have no opinion about');
assertEqual(merged.find(([key]) => key === 'core.hooksPath')?.[1], '/tmp/hooks', 'while core.hooksPath is taken over');

console.log('\n=== issue #2229: git actually writes the trailers and the evidence together ===');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-formal-ai-attribution-'));

const git = (cwd, args, env = {}) => {
  try {
    return { code: 0, output: String(execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })) };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

const makeRepo = name => {
  const repo = path.join(workspace, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--quiet', '--initial-branch', 'main']);
  git(repo, ['config', 'user.email', 'attribution@example.com']);
  git(repo, ['config', 'user.name', 'Attribution Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  return repo;
};

const startSession = async (repo, overrides = {}) => {
  const session = createFormalAiAttributionSession({
    repositoryPath: repo,
    issueNumber: ISSUE,
    version: VERSION,
    model: 'formal-ai',
    tool: 'agent',
    // The real sanitizer loads Secretlint; the boundary itself is exercised
    // separately below with a sanitizer that refuses.
    sanitize: async text => text,
    flushRecordThreshold: 1,
    log: async () => {},
    ...overrides,
  });
  const prepared = await session.prepare();
  return { session, prepared };
};

const repo = makeRepo('agent');
const { session, prepared } = await startSession(repo, { prUrl: PR_URL });
assertEqual(prepared.enabled, true, 'attribution prepares against a real repository');
await session.noteSessionId(SESSION);
await session.recordStreamEvent({ type: 'log', message: 'starting', providerID: 'formalai', modelID: 'formal-ai' });
await session.flush();

const agentGit = session.gitEnv;
const write = (name, content) => fs.writeFileSync(path.join(repo, name), content);

const trailerCount = (cwd, ref, key) => {
  const message = git(cwd, ['show', '-s', '--format=%B', ref]).output;
  return (parseCommitTrailers(message)[key.toLowerCase()] || []).length;
};
const trailerValue = (cwd, ref, key) => {
  const message = git(cwd, ['show', '-s', '--format=%B', ref]).output;
  return (parseCommitTrailers(message)[key.toLowerCase()] || [])[0] ?? null;
};

// 1. `git commit -m` — the ordinary shape.
write('first.txt', 'first\n');
git(repo, ['add', 'first.txt'], agentGit);
assertEqual(git(repo, ['commit', '--quiet', '-m', 'feat: first'], agentGit).code, 0, 'the agent can commit');
assertEqual(trailerValue(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), SESSION, `${FORMAL_AI_TRAILER_KEYS.session} is on the commit`);
assertEqual(trailerValue(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.model), `formal-ai/${VERSION}`, `${FORMAL_AI_TRAILER_KEYS.model} names formal-ai and its version`);
assertEqual(trailerValue(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.evidence), EVIDENCE, `${FORMAL_AI_TRAILER_KEYS.evidence} points at the bundle`);
assertEqual(trailerValue(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.pullRequest), PR_URL, `${FORMAL_AI_TRAILER_KEYS.pullRequest} points at the pull request`);

// The assertion that actually matters: the metric resolves the path against the
// commit's own tree, not against the working tree.
const committedEvidence = git(repo, ['show', `HEAD:${EVIDENCE}/session-id.txt`]);
assertEqual(committedEvidence.code, 0, 'the evidence is inside the very same commit');
assertEqual(committedEvidence.output.includes(`formal-ai session ${SESSION}`), true, 'and records the session id the trailer claims');
assertEqual(committedEvidence.output.includes(`formal-ai model formal-ai/${VERSION}`), true, 'and the model, read from formal-ai --version');
assertEqual(git(repo, ['show', `HEAD:${EVIDENCE}/agent-stream.jsonl`]).output.includes('"type":"log"'), true, 'the Agent CLI stream is committed alongside it');
assertEqual(git(repo, ['status', '--porcelain']).output.trim(), '', 'and the working tree is left clean, so the next iteration is not restarted by residue');

// 2. `git commit -a -m` — no explicit `git add`, and a temporary index.
write('second.txt', 'second\n');
git(repo, ['add', 'second.txt'], agentGit);
git(repo, ['commit', '--quiet', '-m', 'feat: tracked'], agentGit);
write('second.txt', 'second, edited\n');
assertEqual(git(repo, ['commit', '--quiet', '-a', '-m', 'feat: second'], agentGit).code, 0, 'git commit -a works');
assertEqual(trailerValue(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), SESSION, 'and is attributed');
assertEqual(git(repo, ['show', `HEAD:${EVIDENCE}/session-id.txt`]).code, 0, 'with the evidence in its own tree');
assertEqual(git(repo, ['status', '--porcelain']).output.trim(), '', 'and no staged deletion left behind by the temporary index');

// 3. a pathspec commit — the shape that never touches the real index.
write('third.txt', 'third\n');
git(repo, ['add', 'third.txt'], agentGit);
assertEqual(git(repo, ['commit', '--quiet', '-m', 'feat: third', '--', 'third.txt'], agentGit).code, 0, 'a pathspec commit works');
assertEqual(git(repo, ['show', `HEAD:${EVIDENCE}/session-id.txt`]).code, 0, 'and carries the evidence');
assertEqual(git(repo, ['status', '--porcelain']).output.trim(), '', 'and still leaves a clean tree');

// 4. `--amend` must not accumulate a second copy of every trailer.
git(repo, ['commit', '--quiet', '--amend', '-m', 'feat: third (amended)'], agentGit);
assertEqual(trailerCount(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), 1, 'amending replaces the trailers instead of duplicating them');
assertEqual(git(repo, ['show', `HEAD:${EVIDENCE}/session-id.txt`]).code, 0, 'and the amended commit still carries the evidence');

// 5. `--no-verify` skips pre-commit but not prepare-commit-msg. A trailer without
//    evidence is a hard error for the metric, so there must be neither.
const beforeNoVerify = git(repo, ['rev-parse', 'HEAD']).output.trim();
write('fourth.txt', 'fourth\n');
git(repo, ['add', 'fourth.txt'], agentGit);
git(repo, ['rm', '--quiet', '--cached', '-r', EVIDENCE], agentGit);
fs.rmSync(path.join(repo, EVIDENCE), { recursive: true, force: true });
git(repo, ['commit', '--quiet', '--no-verify', '-m', 'feat: unverified'], agentGit);
assertEqual(git(repo, ['rev-parse', 'HEAD']).output.trim() !== beforeNoVerify, true, 'git commit --no-verify still commits');
assertEqual(trailerCount(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), 0, 'but writes no session trailer, because it staged no evidence');
assertEqual(trailerCount(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.evidence), 0, 'and no evidence trailer either — unattributed, never malformed');

// 6. merges are somebody else's work.
git(repo, ['checkout', '--quiet', '-b', 'side', 'HEAD~1'], agentGit);
write('side.txt', 'side\n');
git(repo, ['add', 'side.txt'], agentGit);
git(repo, ['commit', '--quiet', '-m', 'feat: side'], agentGit);
git(repo, ['checkout', '--quiet', 'main'], agentGit);
const mergeResult = git(repo, ['merge', '--quiet', '--no-ff', '-m', 'merge: side', 'side'], agentGit);
assertEqual(mergeResult.code, 0, 'a merge succeeds');
assertEqual(trailerCount(repo, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), 0, 'and is not claimed as the model’s own authored work');

console.log('\n=== issue #2229: attribution never costs the agent a commit ===');

const fragile = makeRepo('fragile');
const { session: fragileSession } = await startSession(fragile);
await fragileSession.noteSessionId(SESSION);
const fragileGit = fragileSession.gitEnv;
fs.writeFileSync(path.join(fragile, 'a.txt'), 'a\n');
git(fragile, ['add', 'a.txt'], fragileGit);
git(fragile, ['commit', '--quiet', '-m', 'feat: attributed'], fragileGit);
assertEqual(trailerCount(fragile, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), 1, 'the first commit is attributed');

// Whatever happens to the bundle, the agent keeps working.
fs.rmSync(fragileSession.stagingDir, { recursive: true, force: true });
fs.writeFileSync(path.join(fragile, 'b.txt'), 'b\n');
git(fragile, ['add', 'b.txt'], fragileGit);
const afterLoss = git(fragile, ['commit', '--quiet', '-m', 'feat: after the bundle vanished'], fragileGit);
assertEqual(afterLoss.code, 0, 'a destroyed staging directory does not stop the agent from committing');
assertEqual(trailerCount(fragile, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), 0, 'the commit is simply unattributed');
assertEqual(git(fragile, ['show', '-s', '--format=%s', 'HEAD']).output.trim(), 'feat: after the bundle vanished', 'and the agent’s message is untouched');

// A hook that was already there keeps running: taking over core.hooksPath must
// not disable the push guard a routed task is held to (issue #2164).
const delegating = makeRepo('delegating');
fs.writeFileSync(path.join(delegating, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "previous hook ran" >> "$(git rev-parse --show-toplevel)/hook-log.txt"\nexit 0\n', { mode: 0o755 });
fs.chmodSync(path.join(delegating, '.git', 'hooks', 'pre-commit'), 0o755);
fs.writeFileSync(path.join(delegating, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 17\n', { mode: 0o755 });
fs.chmodSync(path.join(delegating, '.git', 'hooks', 'pre-push'), 0o755);
const { session: delegatingSession } = await startSession(delegating);
await delegatingSession.noteSessionId(SESSION);
fs.writeFileSync(path.join(delegating, 'c.txt'), 'c\n');
git(delegating, ['add', 'c.txt'], delegatingSession.gitEnv);
git(delegating, ['commit', '--quiet', '-m', 'feat: delegated'], delegatingSession.gitEnv);
assertEqual(fs.existsSync(path.join(delegating, 'hook-log.txt')), true, 'the repository’s own pre-commit hook still runs');
assertEqual(fs.existsSync(path.join(delegatingSession.hooksDir, 'pre-push')), true, 'and the guard hook we have no opinion about is preserved');
const guardRemote = path.join(workspace, 'guard-remote.git');
git(workspace, ['init', '--quiet', '--bare', guardRemote]);
git(delegating, ['remote', 'add', 'origin', guardRemote], delegatingSession.gitEnv);
assertEqual(git(delegating, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], delegatingSession.gitEnv).code !== 0, true, 'a pre-push hook that refuses a push still refuses it');

console.log('\n=== issue #2229: the evidence is a publication boundary ===');

const guarded = makeRepo('guarded');
const { session: guardedSession } = await startSession(guarded, {
  sanitize: async () => {
    throw new Error('token found');
  },
});
await guardedSession.noteSessionId(SESSION);
await guardedSession.recordStreamEvent({ type: 'log', message: 'ghp_thisLooksLikeASecret' });
await guardedSession.flush();
fs.writeFileSync(path.join(guarded, 'd.txt'), 'd\n');
git(guarded, ['add', 'd.txt'], guardedSession.gitEnv);
git(guarded, ['commit', '--quiet', '-m', 'feat: sanitized'], guardedSession.gitEnv);
const publishedStream = git(guarded, ['show', `HEAD:${EVIDENCE}/agent-stream.jsonl`]).output;
assertEqual(publishedStream.includes('ghp_thisLooksLikeASecret'), false, 'a record the sanitizer refuses is never committed');
assertEqual(publishedStream.includes('hive-mind.redacted'), true, 'and the gap is recorded rather than hidden');
assertEqual(trailerCount(guarded, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), 1, 'while the commit is still attributed');

console.log('\n=== issue #2229: a hosted model mid-session stops attribution ===');

const hosted = makeRepo('hosted');
const hostedReasons = [];
const { session: hostedSession } = await startSession(hosted, { log: async message => hostedReasons.push(String(message)) });
await hostedSession.noteSessionId(SESSION);
fs.writeFileSync(path.join(hosted, 'e.txt'), 'e\n');
git(hosted, ['add', 'e.txt'], hostedSession.gitEnv);
git(hosted, ['commit', '--quiet', '-m', 'feat: before the fallback'], hostedSession.gitEnv);
assertEqual(trailerCount(hosted, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), 1, 'work done as formal-ai is attributed');

await hostedSession.recordStreamEvent({ type: 'log', message: 'using explicit provider/model', providerID: 'anthropic', modelID: 'claude-sonnet-4-5' });
assertEqual(hostedSession.enabled, false, 'a stream record naming a hosted model disables attribution');
assertEqual(hostedSession.rejection.includes('anthropic'), true, 'the reason names the identity the stream reported');
assertEqual(
  hostedReasons.some(message => message.includes('Formal AI attribution disabled') && message.includes('anthropic')),
  true,
  'and the reason is printed'
);
fs.writeFileSync(path.join(hosted, 'f.txt'), 'f\n');
git(hosted, ['add', 'f.txt'], hostedSession.gitEnv);
git(hosted, ['commit', '--quiet', '-m', 'feat: after the fallback'], hostedSession.gitEnv);
assertEqual(trailerCount(hosted, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), 0, 'and no later commit claims to be formal-ai’s work');

const rejectedTool = createFormalAiAttributionSession({ repositoryPath: hosted, issueNumber: ISSUE, version: VERSION, model: 'anthropic/claude-sonnet-4-5', log: async () => {} });
const rejectedPrepare = await rejectedTool.prepare();
assertEqual(rejectedPrepare.enabled, false, 'a session started on a hosted model never arms in the first place');
assertEqual(rejectedPrepare.reason.includes('claude'), true, 'with the reason given');
assertEqual(Object.keys(rejectedPrepare.env).length, 0, 'and no hooks are handed to it');

console.log('\n=== issue #2229: the pull request URL can arrive after the commit ===');

const late = makeRepo('late');
const lateRemote = path.join(workspace, 'late-remote.git');
git(workspace, ['init', '--quiet', '--bare', lateRemote]);
git(late, ['remote', 'add', 'origin', lateRemote]);
fs.writeFileSync(path.join(late, 'base.txt'), 'base\n');
git(late, ['add', 'base.txt']);
git(late, ['commit', '--quiet', '-m', 'chore: bootstrap']);
git(late, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
git(late, ['fetch', '--quiet', 'origin']);

const { session: lateSession } = await startSession(late);
await lateSession.noteSessionId(SESSION);
fs.writeFileSync(path.join(late, 'g.txt'), 'g\n');
git(late, ['add', 'g.txt'], lateSession.gitEnv);
git(late, ['commit', '--quiet', '-m', 'feat: authored before the pull request existed'], lateSession.gitEnv);
assertEqual(trailerValue(late, 'HEAD', FORMAL_AI_TRAILER_KEYS.pullRequest), null, 'the commit starts without a pull request trailer');

const treeBefore = git(late, ['rev-parse', 'HEAD^{tree}']).output.trim();
const authorBefore = git(late, ['show', '-s', '--format=%an <%ae> %aI', 'HEAD']).output.trim();
await lateSession.setPullRequestUrl(PR_URL);
const backfilled = await lateSession.backfillPullRequestTrailer({ branchName: 'main' });
assertEqual(backfilled.rewritten, 1, 'the unpushed commit is given its pull request trailer');
assertEqual(trailerValue(late, 'HEAD', FORMAL_AI_TRAILER_KEYS.pullRequest), PR_URL, 'which is now on the commit');
assertEqual(trailerValue(late, 'HEAD', FORMAL_AI_TRAILER_KEYS.session), SESSION, 'the other trailers survive the rewrite');
assertEqual(git(late, ['rev-parse', 'HEAD^{tree}']).output.trim(), treeBefore, 'the tree is byte-identical, so nothing about the change was altered');
assertEqual(git(late, ['show', '-s', '--format=%an <%ae> %aI', 'HEAD']).output.trim(), authorBefore, 'and so is the authorship');
assertEqual(git(late, ['status', '--porcelain']).output.trim(), '', 'and the working tree is still clean afterwards');

// Already-pushed history is never rewritten, whatever the trailers say.
git(late, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
git(late, ['fetch', '--quiet', 'origin']);
const pushedTip = git(late, ['rev-parse', 'HEAD']).output.trim();
const noop = await lateSession.backfillPullRequestTrailer({ branchName: 'main' });
assertEqual(noop.rewritten, 0, 'a pushed commit is left alone');
assertEqual(git(late, ['rev-parse', 'HEAD']).output.trim(), pushedTip, 'and history is untouched');

console.log('\n=== issue #2229: the run reports what the metric would say ===');

const report = await lateSession.finalize({ branchName: 'main', baseRef: 'origin/main~1' });
assertEqual(report.attributed.length, 1, 'finalize confirms the commit the metric will count');
assertEqual(report.attributed[0].pullRequest, PR_URL, 'including its pull request');
assertEqual(report.malformed.length, 0, 'and finds nothing malformed');

// A commit that claims attribution without carrying the evidence is exactly what
// fails formal-ai's release gate, so the report has to name it.
const broken = makeRepo('broken');
fs.writeFileSync(path.join(broken, 'h.txt'), 'h\n');
git(broken, ['add', 'h.txt']);
git(broken, ['commit', '--quiet', '-m', `feat: lying\n\n${FORMAL_AI_TRAILER_KEYS.session}: ${SESSION}\n${FORMAL_AI_TRAILER_KEYS.evidence}: ${EVIDENCE}\n`]);
const brokenMessages = [];
const { session: brokenSession } = await startSession(broken, { log: async message => brokenMessages.push(String(message)) });
await brokenSession.noteSessionId(SESSION);
const brokenReport = await brokenSession.verify({ branchName: 'HEAD' });
assertEqual(brokenReport.malformed.length, 1, 'a commit whose evidence is missing from its own tree is reported');
assertEqual(brokenReport.malformed[0].reason.includes('not present in the commit'), true, 'with the reason the metric would give');

console.log('\n=== issue #2229: the bundle leaves no untracked residue ===');

const excluded = makeRepo('excluded');
const excludeResult = await ensureEvidenceExcluded({ gitDir: path.join(excluded, '.git'), evidencePath: EVIDENCE });
assertEqual(excludeResult.applied, true, 'the evidence directory is excluded locally');
fs.mkdirSync(path.join(excluded, EVIDENCE), { recursive: true });
fs.writeFileSync(path.join(excluded, EVIDENCE, 'session-id.txt'), 'stale\n');
assertEqual(git(excluded, ['status', '--porcelain']).output.trim(), '', 'so an abandoned commit leaves nothing for git status to report');
assertEqual(git(excluded, ['add', '-f', '--', EVIDENCE]).code, 0, 'while the hooks can still stage it with -f');
assertEqual((await ensureEvidenceExcluded({ gitDir: path.join(excluded, '.git'), evidencePath: EVIDENCE })).reason, 'already_present', 'and the exclude entry is written only once');

fs.rmSync(workspace, { recursive: true, force: true });

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
