#!/usr/bin/env node

/**
 * Regression test for issue #2148.
 *
 * A usage limit reached inside auto-restart-until-mergeable is handled in the
 * same process. The continuation uses `--resume`, so it must announce an
 * auto-resume and then pass a successful result through the normal iteration
 * reporting path (working-session summary, log upload, and PR issue-link
 * verification).
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { postWorkSessionStartComment, SESSION_TYPES } from '../src/solve.session.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const autoMergeSource = await readFile(path.join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');

const usageLimitStart = autoMergeSource.indexOf('// Issue #1356: Check for usage limit errors FIRST');
const iterationReportingStart = autoMergeSource.indexOf('// Success - capture latest session data', usageLimitStart);

assert.ok(usageLimitStart >= 0, 'the in-process usage-limit handler must exist');
assert.ok(iterationReportingStart > usageLimitStart, 'the shared successful-iteration reporting path must follow the usage-limit handler');

const usageLimitFlow = autoMergeSource.slice(usageLimitStart, iterationReportingStart);
const iterationReportingFlow = autoMergeSource.slice(iterationReportingStart, autoMergeSource.indexOf('// Issue #1827:', iterationReportingStart));

assert.match(usageLimitFlow, /autoResumeMode:\s*'resume'/, 'the limit notice must describe the actual --resume continuation');
assert.match(usageLimitFlow, /postWorkSessionStartComment\s*\(\s*\{/, 'the resumed session must post a tracked work-session start comment');
assert.match(usageLimitFlow, /sessionType:\s*SESSION_TYPES\.AUTO_RESUME/, 'the start comment must use the Auto Resume (on limit reset) marker');

assert.match(autoMergeSource, /let toolResult\s*=\s*await executeToolIteration/, 'the initial result must be replaceable by a successful resumed result');
assert.match(usageLimitFlow, /toolResult\s*=\s*resumeResult/, 'a successful resumed result must flow into common iteration reporting');

assert.match(iterationReportingFlow, /maybeAttachWorkingSessionSummary\s*\(/, 'the common path must publish the working-session summary');
assert.match(iterationReportingFlow, /attachLogToGitHub\s*\(/, 'the common path must upload the session log');
assert.match(iterationReportingFlow, /ensurePullRequestIssueLink\s*\(/, 'the common path must verify the PR issue link');
assert.match(iterationReportingFlow, /resumedAfterUsageLimit\s*\?\s*`⏰ \$\{AUTO_RESUME_ON_LIMIT_RESET_MARKER\}/, 'the uploaded log must identify the limit-reset resume');

let postedPayload;
const fakeDollar =
  options =>
  (strings, ...values) => {
    const command = strings.reduce((result, part, index) => result + part + (index < values.length ? values[index] : ''), '');
    assert.match(command, /repos\/link-assistant\/hive-mind\/issues\/2149\/comments -X POST --input -/);
    postedPayload = JSON.parse(options.stdin);
    return Promise.resolve({ code: 0, stdout: Buffer.from('{"id":2148001}'), stderr: Buffer.from('') });
  };
const logLines = [];

await postWorkSessionStartComment({
  owner: 'link-assistant',
  repo: 'hive-mind',
  prNumber: 2149,
  $: fakeDollar,
  log: async message => logLines.push(message),
  formatAligned: (...parts) => parts.join(' '),
  sessionType: SESSION_TYPES.AUTO_RESUME,
  timestamp: new Date('2026-08-11T02:00:54.000Z'),
});

assert.match(postedPayload.body, /⏰ \*\*Auto Resume \(on limit reset\)\*\*/);
assert.match(postedPayload.body, /2026-08-11T02:00:54\.000Z/);
assert.match(postedPayload.body, /previous context preserved/);
assert.ok(logLines.some(line => line.includes('Auto Resume (on limit reset) comment (id=2148001)')));

console.log('Issue #2148 auto-resume reporting regression test passed');
