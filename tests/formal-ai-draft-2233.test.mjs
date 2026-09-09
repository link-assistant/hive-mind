/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2233 — "Open a Formal AI draft for every new
 * issue".
 *
 * The expensive failure this test exists to prevent: a flag typo. The draft
 * workflow's whole cost is paid inside a container, forty minutes after the
 * event, with a model on the other end. `solve` parses its arguments with
 * `.strict()`, so `--attatch-logs` or a renamed option does not degrade — it
 * exits immediately, and the only evidence is a red workflow on someone else's
 * issue. So the command the workflow builds is parsed here, through solve's own
 * `createYargsConfig`, and the values it produces are asserted one by one.
 *
 * The rest is the policy #2233 asks for, made checkable:
 *   - the trigger is `issues: opened`, not a curated label;
 *   - a draft is never merged and never closed on failure — it "stays open and
 *     red until a later run succeeds";
 *   - no human commit lands on the branch;
 *   - a failed draft leaves its session log attached.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2233
 * @see docs/FORMAL-AI-DRAFTS.md
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildDockerArgv, buildGitIdentityEnv, buildSolveArgv, DRAFT_DECISION_CODES, DRAFT_GIT_IDENTITY, decideDraft, FORBIDDEN_DRAFT_SOLVE_FLAGS, FORMAL_AI_DRAFT_LABEL, FORMAL_AI_DRAFT_OPT_OUT_LABEL, formatDecisionOutputs, keepPullRequestAsDraftArgs, labelPullRequestArgs, readIssueEvent, selectDraftPullRequest } from '../scripts/formal-ai-draft.lib.mjs';
import { createYargsConfig } from '../src/solve.config.lib.mjs';
import { resolveYargsFactory } from '../src/yargs-factory.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const ISSUE_URL = 'https://github.com/link-assistant/hive-mind/issues/2233';
const workflow = readFileSync('.github/workflows/formal-ai-draft.yml', 'utf8');

const openedIssue = (overrides = {}) => ({ number: 2233, html_url: ISSUE_URL, labels: [], user: { login: 'konard', type: 'User' }, ...overrides });

// --- The command actually parses -----------------------------------------
//
// This is the assertion the file is for. Everything else is cheaper to notice.

{
  const use = await ensureUseM();
  const yargs = resolveYargsFactory(await use('yargs@17.7.2'));
  const argv = await createYargsConfig(yargs(buildSolveArgv({ issueUrl: ISSUE_URL, logDir: '/home/box/logs' }))).parse();

  assert.equal(argv.tool, 'agent', 'the draft runs the Agent CLI (#2233 item 2)');
  assert.equal(argv.model, 'formal-ai', 'the draft runs the Formal AI model (#2233 item 2)');
  assert.equal(argv.attachLogs, true, '#2233 done-when: "a draft that fails leaves its session log attached"');
  assert.equal(argv.verbose, true, '#2233 done-when: `--attach-logs --verbose`');
  assert.equal(argv.attribution, 'formal-ai', 'the four trailers and the evidence bundle are the done-when condition, so attribution is forced rather than left on `auto` (#2230)');
  assert.equal(argv.logDir, '/home/box/logs', 'the session log lands where the workflow can upload it');

  assert.equal(argv.autoRestartUntilMergeable, false, 'the run must not loop watching CI: #2233 says a failed draft "stays open and red until a later run succeeds", and the later run is the next attempt, not this one restarting for up to 24 hours');
  assert.equal(argv.autoMerge, false, 'a draft is "never hand-corrected and merged" (#2233 item 3)');
  assert.equal(argv.autoClosePullRequestOnFail, false, 'a failed draft stays open — closing it would discard the evidence the exercise exists to collect');

  // solve declares `.command('$0 <issue-url>')`, so the URL binds to the named
  // positional and `argv._` stays empty. Asserting on `argv._` here would pass
  // vacuously against a command line that had dropped the URL entirely.
  assert.equal(argv.issueUrl, ISSUE_URL, 'the issue URL binds to the `issue-url` positional');
  assert.deepEqual(argv._, [], 'nothing else is left over as a positional — a stray word would mean a malformed flag');
}

{
  // `.strict()` would have rejected an unknown flag above. Prove that claim,
  // so the test above is known to be load-bearing rather than permissive.
  const use = await ensureUseM();
  const yargs = resolveYargsFactory(await use('yargs@17.7.2'));
  await assert.rejects(
    async () =>
      createYargsConfig(yargs([ISSUE_URL, '--attatch-logs']))
        .fail(false)
        .parse(),
    /Unknown argument/i,
    "solve's parser is strict, so a typo in the draft command cannot pass silently"
  );
}

{
  const argv = buildSolveArgv({ issueUrl: ISSUE_URL });
  for (const flag of FORBIDDEN_DRAFT_SOLVE_FLAGS) {
    assert.ok(!argv.includes(flag), `${flag} must never appear in a draft run`);
  }
  assert.throws(() => buildSolveArgv({ issueUrl: 'not-a-url' }), /github\.com issue URL/, 'a malformed URL fails here rather than inside the container');
  assert.throws(() => buildSolveArgv({ issueUrl: `${ISSUE_URL}; rm -rf /` }), /github\.com issue URL/, 'the URL comes from a webhook payload and is validated before use');
}

// --- Whether to attempt at all -------------------------------------------

{
  assert.equal(decideDraft({ action: 'opened', issue: openedIssue(), hasToken: true }).run, true, 'a freshly opened issue gets an attempt — no curated label required (#2233 item 1)');

  assert.equal(decideDraft({ action: 'labeled', issue: openedIssue(), hasToken: true }).code, DRAFT_DECISION_CODES.notOpened, 'only the `opened` action attempts a draft; relabelling an old issue must not re-run the model');
  assert.equal(decideDraft({ action: 'opened', issue: null, hasToken: true }).code, DRAFT_DECISION_CODES.missingIssue);
  assert.equal(decideDraft({ action: 'opened', issue: openedIssue({ pull_request: { url: 'x' } }), hasToken: true }).code, DRAFT_DECISION_CODES.pullRequest, 'GitHub delivers pull requests on the `issues` event too');
  assert.equal(decideDraft({ action: 'opened', issue: openedIssue({ user: { login: 'dependabot[bot]', type: 'Bot' } }), hasToken: true }).code, DRAFT_DECISION_CODES.botAuthor, 'a bot-filed issue must not start a second automation');
  assert.equal(decideDraft({ action: 'opened', issue: openedIssue({ labels: [{ name: FORMAL_AI_DRAFT_OPT_OUT_LABEL }] }), hasToken: true }).code, DRAFT_DECISION_CODES.optOut);
  assert.equal(decideDraft({ action: 'opened', issue: openedIssue({ labels: [FORMAL_AI_DRAFT_OPT_OUT_LABEL.toUpperCase()] }), hasToken: true }).code, DRAFT_DECISION_CODES.optOut, 'labels are matched case-insensitively and in both payload shapes');
  assert.equal(decideDraft({ action: 'opened', issue: openedIssue({ labels: [{ name: FORMAL_AI_DRAFT_LABEL }] }), hasToken: true }).code, DRAFT_DECISION_CODES.alreadyDrafted);

  const noToken = decideDraft({ action: 'opened', issue: openedIssue(), hasToken: false });
  assert.equal(noToken.run, false, 'a fork or an unconfigured repository skips instead of failing');
  assert.equal(noToken.code, DRAFT_DECISION_CODES.missingToken);
  assert.match(noToken.reason, /GITHUB_TOKEN does not trigger/, 'the skip explains why a PAT is required rather than just naming a missing secret');

  // The missing-token check is deliberately last: otherwise every bot-filed
  // issue in a repository without the secret would report the wrong reason.
  assert.equal(decideDraft({ action: 'opened', issue: openedIssue({ user: { login: 'renovate[bot]', type: 'Bot' } }), hasToken: false }).code, DRAFT_DECISION_CODES.botAuthor);
}

{
  assert.deepEqual(readIssueEvent({ action: 'opened', issue: { number: 7 } }), { action: 'opened', issue: { number: 7 } });
  assert.deepEqual(readIssueEvent(null), { action: null, issue: null }, 'a missing payload is data, not a crash');

  const outputs = formatDecisionOutputs({ run: false, code: 'x', reason: 'a reason\nwith a newline' });
  assert.equal(outputs, 'should_run=false\ndecision_code=x\ndecision_reason=a reason with a newline\n', 'a multi-line reason cannot inject extra $GITHUB_OUTPUT keys');
}

// --- No human commit on the branch ---------------------------------------

{
  const identity = buildGitIdentityEnv();
  assert.equal(identity.GIT_CONFIG_COUNT, '3', 'GIT_CONFIG_COUNT must match the number of key/value pairs or git ignores the tail');
  assert.equal(identity.GIT_CONFIG_VALUE_1, DRAFT_GIT_IDENTITY.name);
  assert.equal(identity.GIT_CONFIG_VALUE_2, DRAFT_GIT_IDENTITY.email);
  assert.match(DRAFT_GIT_IDENTITY.name, /^github-actions\[bot\]$/, '#2233 done-when: "no human commit on its branch"');

  const keys = [identity.GIT_CONFIG_KEY_0, identity.GIT_CONFIG_KEY_1, identity.GIT_CONFIG_KEY_2];
  assert.deepEqual(keys, ['init.defaultBranch', 'user.name', 'user.email']);
}

// --- The container invocation --------------------------------------------

{
  const argv = buildDockerArgv({ solveArgv: buildSolveArgv({ issueUrl: ISSUE_URL, logDir: '/home/box/logs' }), hostLogDir: '/tmp/logs' });

  assert.deepEqual(argv.slice(0, 4), ['run', '--rm', '--user', 'box'], 'the image runs as its unprivileged user, and the container is not kept');
  assert.ok(argv.includes('-v') && argv.includes('/tmp/logs:/home/box/logs'), 'the session log directory is bind-mounted out, so the log survives the container (#2233 done-when)');
  assert.equal(argv[argv.indexOf('solve') + 1], ISSUE_URL, 'solve receives the issue URL as its first argument');

  const forwarded = argv.filter((value, index) => argv[index - 1] === '-e');
  assert.ok(forwarded.includes('GH_TOKEN'), 'the token is forwarded by name');
  assert.ok(
    forwarded.every(value => !/^GH_TOKEN=/.test(value)),
    'a secret must be forwarded by name, never written into an argument list where `ps` can read it'
  );

  assert.throws(() => buildDockerArgv({ solveArgv: [] }), /buildSolveArgv/);
}

// --- Finding, and keeping, the draft --------------------------------------

{
  const open = [
    { number: 10, headRefName: 'issue-22-aaaa', isDraft: false },
    { number: 11, headRefName: 'issue-223-bbbb', isDraft: true },
    { number: 12, headRefName: 'issue-223-cccc', isDraft: false },
    { number: 13, headRefName: 'main', isDraft: false },
  ];

  assert.equal(selectDraftPullRequest(open, 223).number, 12, 'the newest pull request for the issue wins — a re-attempt supersedes the previous draft');
  assert.equal(selectDraftPullRequest(open, 22).number, 10, 'issue 22 must not match the branch of issue 223');
  assert.equal(selectDraftPullRequest(open, 999), null, 'no pull request is not an error: the session log is the record');
  assert.equal(selectDraftPullRequest(null, 1), null);

  assert.deepEqual(keepPullRequestAsDraftArgs({ repository: 'o/r', number: 12 }), ['pr', 'ready', '12', '--undo', '--repo', 'o/r'], 'solve marks the pull request ready at session end (#2123/#2182); a Formal AI draft must go back to draft so it cannot be merged');
  assert.deepEqual(labelPullRequestArgs({ repository: 'o/r', number: 12 }), ['pr', 'edit', '12', '--add-label', FORMAL_AI_DRAFT_LABEL, '--repo', 'o/r']);
}

// --- The workflow -----------------------------------------------------------

{
  assert.match(workflow, /on:\s*\n\s*issues:\s*\n\s*types:\s*\[opened\]/, '#2233 item 1: the trigger is `issues: opened`, not a curated label');
  assert.match(workflow, /workflow_dispatch:/, 'a maintainer can replay an attempt that failed for an infrastructure reason');
  assert.match(workflow, /timeout-minutes:\s*\d+/, 'enforced repository-wide by tests/ci-workflow-timeouts-2082.test.mjs; asserted here because this job runs a model');
  assert.match(workflow, /cancel-in-progress:\s*false/, 'an attempt already writing to a branch must not be killed halfway through');
  assert.match(workflow, /group:\s*formal-ai-draft-.*issue/, 'the concurrency group is per issue, so unrelated issues do not queue behind each other');
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read\s*\n\s*issues:\s*read/, 'GITHUB_TOKEN stays read-only; every write goes through the draft token');
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /node scripts\/formal-ai-draft\.mjs/, 'the command lives in the tested script, not inline in YAML');
  assert.match(workflow, /actions\/upload-artifact@v7/, 'the session log is uploaded even when no pull request was opened');
  // Comments are stripped first: the workflow explains in prose why it does not
  // use `always()`, and a check that trips over its own rationale is a bad check.
  const workflowCode = workflow.replace(/^\s*#.*$/gm, '');
  assert.ok(!/\balways\(\)/.test(workflowCode), 'use !cancelled() — see tests/ci-workflow-cancellation-2082.test.mjs');
  assert.match(workflowCode, /!cancelled\(\)/, 'the log upload still runs when the model run fails — that is the run worth reading');

  for (const forbidden of ['github.event.issue.title', 'github.event.issue.body']) {
    assert.ok(!workflow.includes(forbidden), `${forbidden} must never be interpolated: an issue title is attacker-controlled text (template injection)`);
  }
}

// --- The failure policy is written down, in every language ------------------

{
  for (const suffix of ['', '.zh', '.hi', '.ru']) {
    const doc = readFileSync(`docs/FORMAL-AI-DRAFTS${suffix}.md`, 'utf8');
    assert.match(doc, /FORMAL_AI_DRAFT_TOKEN/, `docs/FORMAL-AI-DRAFTS${suffix}.md names the secret the workflow needs`);
    assert.match(doc, /formal-ai-draft/, `docs/FORMAL-AI-DRAFTS${suffix}.md names the label`);
    assert.match(doc, /--attach-logs/, `docs/FORMAL-AI-DRAFTS${suffix}.md quotes the command`);
    assert.match(doc, /2233/, `docs/FORMAL-AI-DRAFTS${suffix}.md links the issue it answers`);
  }
}

console.log('formal-ai-draft-2233.test.mjs: all assertions passed');
