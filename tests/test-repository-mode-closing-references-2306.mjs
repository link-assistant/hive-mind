#!/usr/bin/env node

/**
 * Tests for issue #2306: a repository-mode pull request was merged by
 * `--auto-merge` although it closed only the combined issue, not the issues
 * listed in it.
 *
 * Reproduction data: konard/vietnam-accomodation-search issue #50 and pull
 * request #51, saved under docs/case-studies/issue-2306/data/.
 *
 *   - RC1: issues still attached to a stale parent could not be attached again
 *     (HTTP 422 "Sub issue may only have one parent").
 *   - RC2: the ensure-sub-issues check only saw native sub-issues, not the
 *     closing references required by the combined issue body.
 *   - RC3: missing closing references did not block `--auto-merge`.
 *   - RC4: the log was not re-uploaded after the post-solve restart iterations.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2306
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { REPOSITORY_MODE_MARKER, REQUIRED_CLOSING_REFERENCES_HEADING, buildCombinedIssueBody, isRepositoryModeIssueBody, parseRequiredClosingReferences } from '../src/solve.repository-mode.lib.mjs';
import { attachSubIssues, isAlreadyHasParentError, shouldReplaceSubIssueParent } from '../src/solve.repository-mode.run.lib.mjs';
import { buildAddSubIssueApiArgs, buildParentIssueApiArgs } from '../src/task.split.lib.mjs';
import { MISSING_CLOSING_REFERENCES_REASON, buildMissingClosingReferencesBlocker, evaluateClosingReferencesGate, mergeRequiredSubIssues } from '../src/solve.ensure-sub-issues.detect.lib.mjs';
import { STOP_REASONS, buildAutoMergeBlockedComment } from '../src/automation-stop-reporting.lib.mjs';
import { attachLogAfterPostSolveRestarts } from '../src/attach-logs-guarantee.lib.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const readSrc = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

const issue50 = await readJson('../docs/case-studies/issue-2306/data/issue-50.json');
const pr51 = await readJson('../docs/case-studies/issue-2306/data/pr-51.json');
const pr51Text = [pr51.title || '', pr51.body || ''].join('\n\n');

// ---------------------------------------------------------------------------
// Reproduction: the real combined issue #50 and pull request #51
// ---------------------------------------------------------------------------

test('reproduction: #50 requires closing references for seven issues', () => {
  assert.equal(isRepositoryModeIssueBody(issue50.body), true);
  assert.deepEqual(parseRequiredClosingReferences(issue50.body), [16, 39, 40, 41, 42, 43, 48]);
});

test('reproduction: only #48 was a native sub-issue, the check therefore missed six issues', () => {
  // The run attached 1 of 7 issues; the six others kept their old parents.
  const nativeOnly = [{ number: 48, repository: { full_name: 'konard/vietnam-accomodation-search' } }];
  const required = mergeRequiredSubIssues({ subIssues: nativeOnly, requiredNumbers: parseRequiredClosingReferences(issue50.body), owner: 'konard', repo: 'vietnam-accomodation-search' });
  assert.deepEqual(
    required.map(entry => [entry.number, entry.source]),
    [
      [48, 'sub-issue'],
      [16, 'issue-body'],
      [39, 'issue-body'],
      [40, 'issue-body'],
      [41, 'issue-body'],
      [42, 'issue-body'],
      [43, 'issue-body'],
    ]
  );
  assert.equal(required.find(entry => entry.number === 16).url, 'https://github.com/konard/vietnam-accomodation-search/issues/16');
});

test('reproduction: the merged #51 description blocks auto-merge (7 of 7 missing)', () => {
  const gate = evaluateClosingReferencesGate({ ensureEnabled: false, issueBody: issue50.body, subIssues: [{ number: 48 }], prText: pr51Text, owner: 'konard', repo: 'vietnam-accomodation-search', issueNumber: 50, prNumber: 51 });
  assert.equal(gate.enabled, true, 'the repository-mode marker alone enables the gate');
  assert.equal(gate.total, 7);
  assert.deepEqual(
    gate.missing.map(entry => entry.number).sort((a, b) => a - b),
    [16, 39, 40, 41, 42, 43, 48]
  );
  assert.equal(gate.blocker.reason, MISSING_CLOSING_REFERENCES_REASON);
  assert.match(gate.blocker.message, /#51 description does not close 7 of the 7 issue\(s\) required by #50/);
  assert.match(gate.blocker.resolution, /Fixes #48/);
});

test('a description that closes every required issue passes the gate', () => {
  const fixed = `${pr51Text}\n\nFixes #16\nFixes #39\nFixes #40\nFixes #41\nFixes #42\nFixes #43\nFixes #48`;
  const gate = evaluateClosingReferencesGate({ ensureEnabled: false, issueBody: issue50.body, subIssues: [{ number: 48 }], prText: fixed, owner: 'konard', repo: 'vietnam-accomodation-search', issueNumber: 50, prNumber: 51 });
  assert.equal(gate.total, 7);
  assert.equal(gate.missing.length, 0);
  assert.equal(gate.blocker, null);
});

test('a comma separated list still leaves all but the first issue open', () => {
  const gate = evaluateClosingReferencesGate({ ensureEnabled: false, issueBody: issue50.body, subIssues: [], prText: 'Fixes #16, #39, #40, #41, #42, #43, #48', owner: 'konard', repo: 'vietnam-accomodation-search' });
  assert.deepEqual(
    gate.missing.map(entry => entry.number).sort((a, b) => a - b),
    [39, 40, 41, 42, 43, 48]
  );
});

test('the gate stays off for an ordinary issue without --ensure-all-sub-issues-addressed', () => {
  const gate = evaluateClosingReferencesGate({ ensureEnabled: false, issueBody: 'Fixes #1\n\nA normal issue', subIssues: [{ number: 2 }], prText: '' });
  assert.deepEqual(gate, { enabled: false, total: 0, missing: [], blocker: null });
});

test('with --ensure-all-sub-issues-addressed the gate checks native sub-issues of any issue', () => {
  const gate = evaluateClosingReferencesGate({ ensureEnabled: true, issueBody: 'plain', subIssues: [{ number: 2 }, { number: 3 }], prText: 'Fixes #2', owner: 'o', repo: 'r', issueNumber: 1, prNumber: 9 });
  assert.deepEqual(
    gate.missing.map(entry => entry.number),
    [3]
  );
  assert.equal(gate.blocker.reason, MISSING_CLOSING_REFERENCES_REASON);
});

test('no blocker is built when nothing is missing', () => {
  assert.equal(buildMissingClosingReferencesBlocker({ missing: [], total: 3 }), null);
});

// ---------------------------------------------------------------------------
// Parsing the combined issue body
// ---------------------------------------------------------------------------

test('the generated body round-trips through the parser', () => {
  const issues = [
    { number: 3, title: 'Three', url: 'https://github.com/o/r/issues/3' },
    { number: 11, title: 'Eleven', url: 'https://github.com/o/r/issues/11' },
  ];
  const body = buildCombinedIssueBody({ repository: { owner: 'o', repo: 'r', fullName: 'o/r', url: 'https://github.com/o/r' }, issues, totalOpen: 2 });
  assert.ok(body.includes(REQUIRED_CLOSING_REFERENCES_HEADING));
  assert.deepEqual(parseRequiredClosingReferences(body), [3, 11]);
});

test('the parser ignores bodies without the repository-mode marker', () => {
  assert.deepEqual(parseRequiredClosingReferences(`${REQUIRED_CLOSING_REFERENCES_HEADING}\n\n\`\`\`\nFixes #1\n\`\`\``), []);
  assert.deepEqual(parseRequiredClosingReferences(''), []);
  assert.deepEqual(parseRequiredClosingReferences(null), []);
  assert.deepEqual(parseRequiredClosingReferences(`${REPOSITORY_MODE_MARKER}\nno heading`), []);
});

// ---------------------------------------------------------------------------
// RC1: moving issues away from a stale parent
// ---------------------------------------------------------------------------

test('replace_parent is sent as a boolean and sub_issue_id stays last', () => {
  const parentIssue = { owner: 'o', repo: 'r', number: 50 };
  assert.ok(!buildAddSubIssueApiArgs({ parentIssue, subIssueId: 5 }).includes('replace_parent=true'));
  const args = buildAddSubIssueApiArgs({ parentIssue, subIssueId: 5, replaceParent: true });
  assert.equal(args[args.indexOf('replace_parent=true') - 1], '-F');
  assert.equal(args[args.length - 1], 'sub_issue_id=5');
});

test('the parent lookup reads GET /issues/{n}/parent', () => {
  const args = buildParentIssueApiArgs({ owner: 'o', repo: 'r', number: 16 });
  assert.equal(args[1], 'repos/o/r/issues/16/parent');
  assert.ok(!args.includes('-X'), 'the parent lookup must be a GET');
});

test('the GitHub one-parent error is recognized', () => {
  // Exact message from the case-study log (HTTP 422).
  assert.equal(isAlreadyHasParentError(new Error('gh: Validation Failed (HTTP 422)\n{"message":"Validation Failed","errors":[{"resource":"Issue","code":"custom","field":"parent","message":"Sub issue may only have one parent"}]}')), true);
  assert.equal(isAlreadyHasParentError(new Error('Issue already has a parent')), true);
  assert.equal(isAlreadyHasParentError(new Error('You have exceeded a secondary rate limit')), false);
});

test('only closed or generated parents are replaced', () => {
  assert.equal(shouldReplaceSubIssueParent({ number: 20, state: 'closed', body: 'anything' }), true);
  assert.equal(shouldReplaceSubIssueParent({ number: 44, state: 'open', body: `${REPOSITORY_MODE_MARKER}\n# Solve all` }), true);
  assert.equal(shouldReplaceSubIssueParent({ number: 7, state: 'open', body: 'An epic written by a person' }), false);
  assert.equal(shouldReplaceSubIssueParent(null), false);
  assert.equal(shouldReplaceSubIssueParent({}), false);
});

const makeParentRun = parents => {
  const calls = [];
  const run = async (command, args) => {
    calls.push(args);
    const endpoint = String(args.find(part => String(part).startsWith('repos/')) || '');
    if (endpoint.endsWith('/parent')) {
      const number = Number(endpoint.split('/').at(-2));
      return { code: 0, stdout: JSON.stringify(parents[number] || null), stderr: '' };
    }
    if (args.includes('-X')) {
      const id = Number(String(args.at(-1)).split('=')[1]);
      const number = id / 100;
      if (parents[number] && !args.includes('replace_parent=true')) {
        return { code: 1, stdout: '', stderr: 'gh: Sub issue may only have one parent (HTTP 422)' };
      }
      return { code: 0, stdout: '{}', stderr: '' };
    }
    return { code: 0, stdout: '{}', stderr: '' };
  };
  return { run, calls };
};

test('reproduction: issues left under closed combined issues are moved to the new one', async () => {
  // #16 was under closed #20, #39 under closed #44 (the case-study state).
  const parents = {
    16: { number: 20, state: 'closed', body: REPOSITORY_MODE_MARKER, html_url: 'https://github.com/o/r/issues/20' },
    39: { number: 44, state: 'closed', body: REPOSITORY_MODE_MARKER, html_url: 'https://github.com/o/r/issues/44' },
  };
  const { run, calls } = makeParentRun(parents);
  const logs = [];
  const result = await attachSubIssues({
    parentIssue: { owner: 'o', repo: 'r', number: 50 },
    issues: [
      { number: 16, id: 1600 },
      { number: 39, id: 3900 },
      { number: 48, id: 4800 },
    ],
    run,
    log: async line => logs.push(line),
    delayMs: 0,
    maxAttempts: 1,
    sleep: async () => {},
  });
  assert.deepEqual(
    result.attached.map(issue => issue.number),
    [16, 39, 48]
  );
  assert.equal(result.failed.length, 0);
  assert.deepEqual(
    result.moved.map(entry => [entry.issue.number, entry.previousParent.number]),
    [
      [16, 20],
      [39, 44],
    ]
  );
  assert.equal(calls.filter(args => args.includes('replace_parent=true')).length, 2, 'only the moved issues use replace_parent');
  assert.ok(logs.some(line => line.includes('#16 is still a sub-issue of #20')));
});

test('an issue under an open parent written by a person is not stolen', async () => {
  const parents = { 7: { number: 3, state: 'open', body: 'Human epic', html_url: 'https://github.com/o/r/issues/3' } };
  const { run, calls } = makeParentRun(parents);
  const logs = [];
  const result = await attachSubIssues({ parentIssue: { owner: 'o', repo: 'r', number: 50 }, issues: [{ number: 7, id: 700 }], run, log: async line => logs.push(line), delayMs: 0, sleep: async () => {} });
  assert.equal(result.attached.length, 0);
  assert.equal(result.moved.length, 0);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(result.failed[0].currentParent, { number: 3, state: 'open', url: 'https://github.com/o/r/issues/3' });
  assert.ok(!calls.some(args => args.includes('replace_parent=true')));
  assert.ok(logs.some(line => line.includes('still required through the closing references')));
});

// ---------------------------------------------------------------------------
// RC3: auto-merge is blocked and the reason is reported
// ---------------------------------------------------------------------------

test('the blocked-merge comment explains the missing references instead of asking to reopen', () => {
  const gate = evaluateClosingReferencesGate({ ensureEnabled: false, issueBody: issue50.body, subIssues: [], prText: pr51Text, owner: 'konard', repo: 'vietnam-accomodation-search', issueNumber: 50, prNumber: 51 });
  const comment = buildAutoMergeBlockedComment({ blockers: [gate.blocker], issueNumber: 50 });
  assert.match(comment, /missing_closing_references/);
  assert.match(comment, /Add the missing closing references/);
  assert.match(comment, /will then stay open/);
  assert.doesNotMatch(comment, /Reopen issue #50/);
  assert.ok(STOP_REASONS[MISSING_CLOSING_REFERENCES_REASON], 'the stop reason is documented');
});

test('both auto-merge paths run the closing-references gate before merging', async () => {
  const watch = await readSrc('solve.auto-merge.lib.mjs');
  const attempt = await readSrc('solve.auto-merge-attempt.lib.mjs');
  for (const [name, src, mergeCall] of [
    ['solve.auto-merge.lib.mjs', watch, 'mergePullRequest('],
    ['solve.auto-merge-attempt.lib.mjs', attempt, 'await mergePullRequest('],
  ]) {
    const gate = src.indexOf('await checkClosingReferencesBeforeMerge(');
    assert.ok(gate > 0, `${name} must call checkClosingReferencesBeforeMerge`);
    assert.ok(src.indexOf(mergeCall, gate) > gate, `${name} must check before merging`);
  }
});

// ---------------------------------------------------------------------------
// RC4: the log is uploaded again after the post-solve restart iterations
// ---------------------------------------------------------------------------

const logUploadParams = overrides => {
  const uploads = [];
  return {
    uploads,
    params: {
      restartIterationsRan: 1,
      shouldAttachLogs: true,
      prNumber: 51,
      owner: 'o',
      repo: 'r',
      $: null,
      log: async () => {},
      sanitizeLogContent: text => text,
      getLogFile: () => '/tmp/solve.log',
      attachLogToGitHub: async args => {
        uploads.push(args);
        return true;
      },
      argv: { tool: 'codex', model: 'gpt' },
      ...overrides,
    },
  };
};

test('the log is re-attached to the pull request when a restart loop ran', async () => {
  const { uploads, params } = logUploadParams({});
  assert.equal(await attachLogAfterPostSolveRestarts(params), true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].targetType, 'pr');
  assert.equal(uploads[0].targetNumber, 51);
  assert.equal(uploads[0].logFile, '/tmp/solve.log');
  assert.equal(uploads[0].tool, 'codex');
});

test('nothing is uploaded when no restart loop ran, logs are off, or there is no PR', async () => {
  for (const overrides of [{ restartIterationsRan: 0 }, { shouldAttachLogs: false }, { prNumber: null }]) {
    const { uploads, params } = logUploadParams(overrides);
    assert.equal(await attachLogAfterPostSolveRestarts(params), false);
    assert.equal(uploads.length, 0, JSON.stringify(overrides));
  }
});

test('an upload error never escapes', async () => {
  const { params } = logUploadParams({
    attachLogToGitHub: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(await attachLogAfterPostSolveRestarts(params), false);
});

test('solve.mjs re-uploads the log after every post-solve loop', async () => {
  const src = await readSrc('solve.mjs');
  const lastLoop = src.indexOf('applyPostSolveRestart(await runEnsureAllSubIssuesAddressed(');
  const reupload = src.indexOf('await attachLogAfterPostSolveRestarts(');
  assert.ok(lastLoop > 0 && reupload > lastLoop, 'the re-upload must follow the last post-solve loop');
  assert.ok(!/\n\s*applyRestartResult\(await run(Escalation|AutoEnsureRequirements|KeepWorkingUntilDone|EnsureAllSubIssuesAddressed)\(/.test(src), 'every post-solve loop must be counted');
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`All ${passed} issue #2306 closing-reference tests passed.`);
