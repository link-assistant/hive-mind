#!/usr/bin/env node

/**
 * Regression coverage for issue #2007.
 *
 * The issue asks us to double check whether solve has an option that can feed
 * issue/PR events into running AI tools as direct JSON input. The executable
 * contract is intentionally explicit:
 *   - Claude is supported today through the existing stream-json stdin pipe.
 *   - Codex is not wired through solve today because the current runner uses
 *     `codex exec`, whose stdin is one-shot context; the candidate protocol is
 *     Codex app-server `turn/steer`.
 *   - The issue-specific case study must record how to test the supported
 *     option and what remains as follow-up for other tools.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2007
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { SOLVE_OPTION_DEFINITIONS as yargsOptions } from '../src/solve.config.lib.mjs';
import { createBidirectionalHandler, validateBidirectionalModeConfig } from '../src/bidirectional-interactive.lib.mjs';
import { ISSUE_2007_REQUIRED_EVENT_IDS, getLiveInputCapability } from '../src/live-input-capabilities.lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
    return;
  }

  console.log(`  ❌ ${label}`);
  failed++;
}

function assertIncludes(value, needle, label) {
  assert(String(value).includes(needle), `${label} (expected to include ${JSON.stringify(needle)})`);
}

function assertArrayIncludes(array, expected, label) {
  const missing = expected.filter(item => !array.includes(item));
  assert(missing.length === 0, `${label}${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
}

console.log('\n=== Issue #2007 live input capability matrix ===\n');

assertArrayIncludes(ISSUE_2007_REQUIRED_EVENT_IDS, ['issue-title', 'issue-body', 'issue-comments', 'pull-request-comments'], 'required event list covers every user feedback source from issue #2007');
assert(!ISSUE_2007_REQUIRED_EVENT_IDS.includes('pull-request-description'), 'pull request description is not treated as required user feedback input');

const claudeCapability = getLiveInputCapability('claude');
assert(claudeCapability.supported === true, 'Claude is marked as supported for live JSON input');
assertIncludes(claudeCapability.protocol, 'stream-json', 'Claude capability records the stream-json protocol');
assertIncludes(claudeCapability.option, '--auto-input-until-mergeable', 'Claude capability names the testable solve option');
assertArrayIncludes(claudeCapability.events, ISSUE_2007_REQUIRED_EVENT_IDS, 'Claude capability covers all issue #2007 required events');

const codexCapability = getLiveInputCapability('codex');
assert(codexCapability.supported === false, 'Codex is marked as not yet wired for live input in solve');
assertIncludes(codexCapability.currentRunner, 'codex exec', 'Codex capability records the current one-shot runner');
assertIncludes(codexCapability.unsupportedReason, 'one-shot', 'Codex unsupported reason explains the stdin limitation');
assertIncludes(codexCapability.futureProtocol, 'turn/steer', 'Codex capability records app-server turn/steer as the candidate protocol');

const unknownCapability = getLiveInputCapability('new-tool');
assert(unknownCapability.supported === false, 'unknown tools default to unsupported');
assertIncludes(unknownCapability.unsupportedReason, 'No verified', 'unknown tool reason asks for a verified live-input contract');

console.log('\n=== Issue #2007 validator messaging ===\n');

const codexLogs = [];
const codexArgv = {
  autoInputUntilMergeable: true,
  tool: 'codex',
  bidirectionalInteractiveMode: false,
  interactiveMode: false,
  acceptIncommingCommentsAsInput: false,
  excludeAllOwnIncommingCommentsFromInput: false,
  streamCommentsToInput: false,
  queueCommentsToInput: false,
};

const codexOk = await validateBidirectionalModeConfig(codexArgv, async msg => {
  codexLogs.push(String(msg));
});

assert(codexOk === false, 'validator still disables live input for Codex until a supported runner exists');
assert(codexArgv.acceptIncommingCommentsAsInput === false, 'validator resets accept-incomming-comments-as-input for Codex');
assert(codexArgv.queueCommentsToInput === false, 'validator resets queue-comments-to-input for Codex');
assertIncludes(codexLogs.join('\n'), 'codex exec', 'Codex warning names the current runner');
assertIncludes(codexLogs.join('\n'), 'turn/steer', 'Codex warning names the future app-server protocol');

console.log('\n=== Issue #2007 Claude comment surfaces ===\n');

const writtenFrames = [];
const commands = [];
const fakeStdin = {
  destroyed: false,
  writableEnded: false,
  write(chunk, callback) {
    writtenFrames.push(String(chunk));
    if (typeof callback === 'function') callback();
    return true;
  },
};

const mockGh = (strings, ...values) => {
  const command = strings.reduce((acc, part, index) => `${acc}${part}${values[index] ?? ''}`, '');
  commands.push(command);

  if (command.includes('repos/o/r/issues/22/comments')) {
    return Promise.resolve({
      stdout: JSON.stringify([{ id: 201, body: 'PR conversation feedback', created_at: '2026-07-02T10:00:00Z', user: { login: 'reviewer' } }]),
    });
  }
  if (command.includes('repos/o/r/pulls/22/comments')) {
    return Promise.resolve({
      stdout: JSON.stringify([{ id: 202, body: 'Inline review feedback', created_at: '2026-07-02T10:01:00Z', user: { login: 'reviewer' } }]),
    });
  }
  if (command.includes('repos/o/r/issues/11/comments')) {
    return Promise.resolve({
      stdout: JSON.stringify([{ id: 203, body: 'Issue comment feedback', created_at: '2026-07-02T10:02:00Z', user: { login: 'reporter' } }]),
    });
  }

  return Promise.resolve({ stdout: '[]' });
};

const handler = createBidirectionalHandler({
  owner: 'o',
  repo: 'r',
  prNumber: 22,
  issueNumber: 11,
  $: mockGh,
  log: async () => {},
  pollInterval: 60000,
});

handler.attachClaudeStdin(fakeStdin);
await handler.startMonitoring();
await handler.stopMonitoring();

assert(
  commands.some(command => command.includes('repos/o/r/issues/22/comments')),
  'Claude handler polls PR conversation comments'
);
assert(
  commands.some(command => command.includes('repos/o/r/pulls/22/comments')),
  'Claude handler polls PR inline review comments'
);
assert(
  commands.some(command => command.includes('repos/o/r/issues/11/comments')),
  'Claude handler polls linked issue comments'
);
assert(commands.filter(command => command.includes('--paginate --slurp')).length >= 3, 'Claude handler slurps paginated comment endpoints before parsing');
assertIncludes(writtenFrames.join('\n'), 'PR conversation feedback', 'Claude handler streams PR conversation comments');
assertIncludes(writtenFrames.join('\n'), 'Inline review feedback', 'Claude handler streams PR inline review comments');
assertIncludes(writtenFrames.join('\n'), 'Issue comment feedback', 'Claude handler streams linked issue comments');

console.log('\n=== Issue #2007 help text and case study ===\n');

const autoInputOption = yargsOptions['auto-input-until-mergeable'];
assert(autoInputOption.default === false, '--auto-input-until-mergeable remains opt-in');
assertIncludes(autoInputOption.description, 'Claude', '--auto-input-until-mergeable help text names the supported live-input tool');
assertIncludes(autoInputOption.description, 'Codex app-server', '--auto-input-until-mergeable help text points to the Codex follow-up path');

const caseStudy = readFileSync(join(repoRoot, 'docs/case-studies/issue-2007/README.md'), 'utf8');
assertIncludes(caseStudy, '--auto-input-until-mergeable', 'case study explains the testable option');
assertIncludes(caseStudy, 'issue title', 'case study covers issue title updates');
assertIncludes(caseStudy, 'issue description', 'case study covers issue description updates');
assertIncludes(caseStudy, 'issue comments', 'case study covers issue comments');
assertIncludes(caseStudy, 'pull request comments', 'case study covers pull request comments');
assertIncludes(caseStudy, 'codex exec', 'case study records the current Codex runner limitation');
assertIncludes(caseStudy, 'turn/steer', 'case study records the Codex app-server follow-up protocol');

console.log(`\nIssue #2007 test results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
