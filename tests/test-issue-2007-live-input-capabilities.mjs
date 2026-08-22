#!/usr/bin/env node

/**
 * Regression coverage for issue #2007.
 *
 * The issue asks us to feed issue/PR events into running AI tools "in all ways
 * possible", with a universal fallback for tools that lack a live input channel.
 * The executable contract is intentionally explicit:
 *   - Live event input is AVAILABLE for every tool.
 *   - Claude and Agent use STREAM mode: events are written into the live process
 *     via the stream-json stdin pipe.
 *   - Codex/others use FALLBACK mode: the restart/resume loop waits for the
 *     current turn to finish, stops the process, and resumes with the new events.
 *   - The issue-specific case study must record how to test both modes.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2007
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { SOLVE_OPTION_DEFINITIONS as yargsOptions } from '../src/solve.config.lib.mjs';
import { createBidirectionalHandler, validateBidirectionalModeConfig } from '../src/bidirectional-interactive.lib.mjs';
import { ISSUE_2007_REQUIRED_EVENT_IDS, getLiveInputCapability, getLiveInputMode, isLiveInputAvailable, isLiveInputSupported, LIVE_INPUT_MODE_FALLBACK, LIVE_INPUT_MODE_STREAM } from '../src/live-input-capabilities.lib.mjs';
import { checkForIssueMetadataChanges } from '../src/solve.auto-merge-helpers.lib.mjs';

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
assert(claudeCapability.available === true, 'Claude live input is available');
assert(claudeCapability.mode === LIVE_INPUT_MODE_STREAM, 'Claude uses stream mode');
assert(getLiveInputMode('claude') === LIVE_INPUT_MODE_STREAM, 'getLiveInputMode reports stream for Claude');
assert(isLiveInputSupported('claude') === true, 'isLiveInputSupported (streaming predicate) is true for Claude');
assert(isLiveInputAvailable('claude') === true, 'isLiveInputAvailable is true for Claude');
assertIncludes(claudeCapability.protocol, 'stream-json', 'Claude capability records the stream-json protocol');
assertIncludes(claudeCapability.option, '--auto-input-until-mergeable', 'Claude capability names the testable solve option');
assertArrayIncludes(claudeCapability.events, ISSUE_2007_REQUIRED_EVENT_IDS, 'Claude capability covers all issue #2007 required events');

const codexCapability = getLiveInputCapability('codex');
assert(codexCapability.available === true, 'Codex live input is available (via fallback)');
assert(codexCapability.mode === LIVE_INPUT_MODE_FALLBACK, 'Codex uses restart/resume fallback mode');
assert(isLiveInputSupported('codex') === false, 'Codex is not stream-capable (streaming predicate false)');
assert(isLiveInputAvailable('codex') === true, 'isLiveInputAvailable is true for Codex via fallback');
assertArrayIncludes(codexCapability.events, ISSUE_2007_REQUIRED_EVENT_IDS, 'Codex covers all issue #2007 required events through the fallback');
assertIncludes(codexCapability.currentRunner, 'codex exec', 'Codex capability records the current one-shot runner');
assertIncludes(codexCapability.unsupportedReason, 'one-shot', 'Codex reason explains the stdin limitation');
assertIncludes(codexCapability.fallback, 'restart', 'Codex records the universal restart/resume fallback');
assertIncludes(codexCapability.futureProtocol, 'turn/steer', 'Codex capability records app-server turn/steer as the candidate protocol');

const agentCapability = getLiveInputCapability('agent');
assert(agentCapability.available === true, 'Agent live input is available');
assert(agentCapability.mode === LIVE_INPUT_MODE_STREAM, 'Agent uses stream mode after @link-assistant/agent 0.24.1');
assert(getLiveInputMode('agent') === LIVE_INPUT_MODE_STREAM, 'getLiveInputMode reports stream for Agent');
assert(isLiveInputSupported('agent') === true, 'isLiveInputSupported (streaming predicate) is true for Agent');
assert(isLiveInputAvailable('agent') === true, 'isLiveInputAvailable is true for Agent');
assertIncludes(agentCapability.protocol, '--input-format stream-json', 'Agent capability records input stream-json protocol');
assertIncludes(agentCapability.protocol, '--output-format stream-json', 'Agent capability records output stream-json protocol');
assertIncludes(agentCapability.currentRunner, 'src/agent.lib.mjs', 'Agent capability records the live runner');
assertIncludes(agentCapability.agentIssue, 'link-assistant/agent/pull/274', 'Agent capability links the upstream merged live-stream contract PR');
assertArrayIncludes(agentCapability.events, ISSUE_2007_REQUIRED_EVENT_IDS, 'Agent capability covers all issue #2007 required events');

const unknownCapability = getLiveInputCapability('new-tool');
assert(unknownCapability.available === true, 'unknown tools are available through the fallback');
assert(unknownCapability.mode === LIVE_INPUT_MODE_FALLBACK, 'unknown tools default to fallback mode');
assertIncludes(unknownCapability.unsupportedReason, 'restart/resume fallback', 'unknown tool reason explains the fallback');

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
  autoRestartUntilMergeable: true,
};

const codexOk = await validateBidirectionalModeConfig(codexArgv, async msg => {
  codexLogs.push(String(msg));
});

assert(codexOk === true, 'validator keeps --auto-input-until-mergeable valid for Codex via the fallback');
assert(codexArgv.acceptIncommingCommentsAsInput === false, 'validator keeps live comment streaming off for Codex');
assert(codexArgv.queueCommentsToInput === false, 'validator keeps queue-comments-to-input off for Codex (no live pipe)');
assert(codexArgv.autoRestartUntilMergeable === true, 'validator keeps the restart/resume fallback enabled for Codex');
assertIncludes(codexLogs.join('\n'), 'restart/resume fallback', 'Codex log explains the restart/resume fallback');
assertIncludes(codexLogs.join('\n'), 'turn/steer', 'Codex log names the future app-server protocol');

// When the user explicitly disables the fallback, the log must warn that no
// live-input mechanism remains for a non-streaming tool.
const codexNoFallbackLogs = [];
const codexNoFallbackArgv = {
  autoInputUntilMergeable: true,
  tool: 'codex',
  bidirectionalInteractiveMode: false,
  interactiveMode: false,
  acceptIncommingCommentsAsInput: false,
  excludeAllOwnIncommingCommentsFromInput: false,
  streamCommentsToInput: false,
  queueCommentsToInput: false,
  autoRestartUntilMergeable: false,
};
const codexNoFallbackOk = await validateBidirectionalModeConfig(codexNoFallbackArgv, async msg => {
  codexNoFallbackLogs.push(String(msg));
});
assert(codexNoFallbackOk === true, 'validator returns valid config even when fallback is disabled');
assert(codexNoFallbackArgv.autoRestartUntilMergeable === false, 'validator respects an explicit --no-auto-restart-until-mergeable');
assertIncludes(codexNoFallbackLogs.join('\n'), 'no live input mechanism remains', 'validator warns when the fallback is explicitly disabled');

// Claude still uses the live stream-json pipe (stream mode), not the fallback.
const claudeLogs = [];
const claudeArgv = {
  autoInputUntilMergeable: true,
  tool: 'claude',
  bidirectionalInteractiveMode: false,
  interactiveMode: false,
  acceptIncommingCommentsAsInput: false,
  excludeAllOwnIncommingCommentsFromInput: false,
  streamCommentsToInput: false,
  queueCommentsToInput: false,
  autoRestartUntilMergeable: true,
};
const claudeOk = await validateBidirectionalModeConfig(claudeArgv, async msg => {
  claudeLogs.push(String(msg));
});
assert(claudeOk === true, 'validator enables live input for Claude');
assert(claudeArgv.acceptIncommingCommentsAsInput === true, 'validator enables live comment streaming for Claude');
assert(claudeArgv.queueCommentsToInput === true, 'validator defaults Claude to queue delivery mode');

const agentLogs = [];
const agentArgv = {
  autoInputUntilMergeable: true,
  tool: 'agent',
  bidirectionalInteractiveMode: false,
  interactiveMode: false,
  acceptIncommingCommentsAsInput: false,
  excludeAllOwnIncommingCommentsFromInput: false,
  streamCommentsToInput: false,
  queueCommentsToInput: false,
  autoRestartUntilMergeable: true,
};
const agentOk = await validateBidirectionalModeConfig(agentArgv, async msg => {
  agentLogs.push(String(msg));
});
assert(agentOk === true, 'validator enables live input for Agent');
assert(agentArgv.acceptIncommingCommentsAsInput === true, 'validator enables live comment streaming for Agent');
assert(agentArgv.queueCommentsToInput === true, 'validator defaults Agent to queue delivery mode');
assertIncludes(agentLogs.join('\n'), 'Agent', 'Agent validator log names Agent as the feedback target');

console.log('\n=== Issue #2007 stream comment surfaces ===\n');

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

console.log('\n=== Issue #2007 fallback: issue metadata change detection ===\n');

const metadataCommands = [];
let metadataBody = 'Original body';
let metadataTitle = 'Original title';
const metadataGh = (strings, ...values) => {
  const command = strings.reduce((acc, part, index) => `${acc}${part}${values[index] ?? ''}`, '');
  metadataCommands.push(command);
  if (command.includes('repos/o/r/issues/11')) {
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ title: metadataTitle, body: metadataBody }) });
  }
  return Promise.resolve({ code: 0, stdout: '{}' });
};

const baseline = await checkForIssueMetadataChanges('o', 'r', 11, null, false, metadataGh);
assert(baseline.changed === false, 'first metadata check seeds the baseline without reporting a change');
assert(baseline.snapshot?.title === 'Original title', 'baseline captures the issue title');

const unchanged = await checkForIssueMetadataChanges('o', 'r', 11, baseline.snapshot, false, metadataGh);
assert(unchanged.changed === false, 'no change reported when title/body are identical');

metadataTitle = 'Updated title';
metadataBody = 'Updated body';
const changed = await checkForIssueMetadataChanges('o', 'r', 11, baseline.snapshot, false, metadataGh);
assert(changed.changed === true, 'metadata change detected when title and body are edited');
assert(
  changed.changes.some(c => c.field === 'title'),
  'title change reported'
);
assert(
  changed.changes.some(c => c.field === 'body'),
  'body change reported'
);

const noIssue = await checkForIssueMetadataChanges('o', 'r', null, null, false, metadataGh);
assert(noIssue.changed === false, 'missing issue number is a safe no-op');

console.log('\n=== Issue #2007 help text and case study ===\n');

const autoInputOption = yargsOptions['auto-input-until-mergeable'];
assert(autoInputOption.default === false, '--auto-input-until-mergeable remains opt-in');
assertIncludes(autoInputOption.description, 'claude', '--auto-input-until-mergeable help text names Claude as a supported live-input tool');
assertIncludes(autoInputOption.description, 'agent', '--auto-input-until-mergeable help text names Agent as a supported live-input tool');
assertIncludes(autoInputOption.description, 'restart/resume fallback', '--auto-input-until-mergeable help text describes the universal fallback');
assertIncludes(autoInputOption.description, 'Codex app-server', '--auto-input-until-mergeable help text points to the Codex follow-up path');

const caseStudy = readFileSync(join(repoRoot, 'docs/case-studies/issue-2007/README.md'), 'utf8');
assertIncludes(caseStudy, '--auto-input-until-mergeable', 'case study explains the testable option');
assertIncludes(caseStudy, 'issue title', 'case study covers issue title updates');
assertIncludes(caseStudy, 'issue description', 'case study covers issue description updates');
assertIncludes(caseStudy, 'issue comments', 'case study covers issue comments');
assertIncludes(caseStudy, 'pull request comments', 'case study covers pull request comments');
assertIncludes(caseStudy, 'codex exec', 'case study records the current Codex runner limitation');
assertIncludes(caseStudy, 'turn/steer', 'case study records the Codex app-server follow-up protocol');
assertIncludes(caseStudy, 'Agent live stream-json', 'case study records Agent live stream-json support');

console.log(`\nIssue #2007 test results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
