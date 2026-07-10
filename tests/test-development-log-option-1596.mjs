#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { buildSystemPrompt as buildAgentSystemPrompt, buildUserPrompt as buildAgentUserPrompt } from '../src/agent.prompts.lib.mjs';
import { buildSystemPrompt as buildClaudeSystemPrompt, buildUserPrompt as buildClaudeUserPrompt } from '../src/claude.prompts.lib.mjs';
import { buildSystemPrompt as buildCodexSystemPrompt, buildUserPrompt as buildCodexUserPrompt } from '../src/codex.prompts.lib.mjs';
import { buildSystemPrompt as buildGeminiSystemPrompt, buildUserPrompt as buildGeminiUserPrompt } from '../src/gemini.prompts.lib.mjs';
import { buildSystemPrompt as buildOpenCodeSystemPrompt, buildUserPrompt as buildOpenCodeUserPrompt } from '../src/opencode.prompts.lib.mjs';
import { buildSystemPrompt as buildQwenSystemPrompt, buildUserPrompt as buildQwenUserPrompt } from '../src/qwen.prompts.lib.mjs';
import { createDevelopmentLogFinalizer } from '../src/development-log.finalize.lib.mjs';

const option = SOLVE_OPTION_DEFINITIONS['development-log'];
assert.ok(option, '--development-log should be defined');
assert.equal(option.type, 'boolean');
assert.equal(option.default, false);

assert.ok(getSolvePassthroughOptionNames().includes('development-log'), '--development-log should pass through hive');

let finalizerCalls = 0;
let finalizerSessionId = 'initial';
const finalizeDevelopmentLog = createDevelopmentLogFinalizer({
  collect: async params => {
    finalizerCalls++;
    return params.sessionId;
  },
  getParams: () => ({ sessionId: finalizerSessionId }),
});
finalizerSessionId = 'completed-session';
assert.equal(await finalizeDevelopmentLog(), 'completed-session');
assert.equal(await finalizeDevelopmentLog(), 'completed-session');
assert.equal(finalizerCalls, 1, 'success and error paths must share one development-log finalization');

const developmentLog = await import('../src/development-log.lib.mjs');
const { buildDevelopmentLogDirectory, buildCaseStudyDirectory, buildDevelopmentLogPrompt, writeDevelopmentLogArtifacts, collectAndCommitDevelopmentLogArtifacts, isBugIssueType, fetchIssueType } = developmentLog;

assert.equal(buildDevelopmentLogDirectory({ issueNumber: 1596, prNumber: 1996 }), './dev/log/issues/1596/pulls/1996');
assert.equal(buildDevelopmentLogDirectory({ issueNumber: 1596, prNumber: null }), './dev/log/issues/1596/pulls/pending');
assert.equal(buildCaseStudyDirectory({ issueNumber: 1596 }), './docs/case-studies/issue-1596');
assert.equal(buildDevelopmentLogPrompt({ argv: {}, issueNumber: 1596, prNumber: 1996 }), '');

// Issue #1596: bug-type classification.
assert.equal(isBugIssueType('Bug'), true);
assert.equal(isBugIssueType('bug'), true);
assert.equal(isBugIssueType('Feature'), false);
assert.equal(isBugIssueType('Task'), false);
assert.equal(isBugIssueType(null), false);
assert.equal(isBugIssueType(undefined), false);
assert.equal(isBugIssueType(''), false);

// Without an issue type the universal feature/task wording is used and the bug
// "download all logs" wording is NOT injected.
const universalPrompt = buildDevelopmentLogPrompt({ argv: { 'development-log': true }, issueNumber: 1596, prNumber: 1996 });
assert.ok(universalPrompt.includes('./dev/log/issues/1596/pulls/1996'));
assert.ok(universalPrompt.includes('Collect data related about the issue to this repository'));
assert.ok(!universalPrompt.includes('Download all logs'), 'non-bug issues should not get the bug "download all logs" wording');

// A feature/task issue type also gets the universal wording.
const featurePrompt = buildDevelopmentLogPrompt({ argv: { 'development-log': true }, issueNumber: 1596, prNumber: 1996, issueType: 'Feature' });
assert.ok(featurePrompt.includes('Collect data related about the issue to this repository'));
assert.ok(!featurePrompt.includes('Download all logs'));

// A bug issue type gets the stronger "download all logs" wording (via explicit
// param and via argv.issueType, which is how solve threads the detected type).
const bugPromptParam = buildDevelopmentLogPrompt({ argv: { 'development-log': true }, issueNumber: 1596, prNumber: 1996, issueType: 'Bug' });
assert.ok(bugPromptParam.includes('Download all logs and collect data related about the issue to this repository'));
const bugPromptArgv = buildDevelopmentLogPrompt({ argv: { 'development-log': true, issueType: 'Bug' }, issueNumber: 1596, prNumber: 1996 });
assert.ok(bugPromptArgv.includes('Download all logs and collect data related about the issue to this repository'));

// fetchIssueType parses the gh CLI JSON output and tolerates failures.
const fakeIssueTypeRunner = async (strings, ...values) => {
  const command = strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, '');
  assert.ok(command.includes('gh issue view'), 'fetchIssueType should call gh issue view');
  return { code: 0, stdout: JSON.stringify({ issueType: { name: 'Bug' } }), stderr: '' };
};
assert.equal(await fetchIssueType({ owner: 'link-assistant', repo: 'hive-mind', issueNumber: 1596, $: fakeIssueTypeRunner }), 'Bug');
assert.equal(await fetchIssueType({ owner: 'link-assistant', repo: 'hive-mind', issueNumber: 1596, $: async () => ({ code: 1, stdout: '', stderr: 'boom' }) }), null);
assert.equal(await fetchIssueType({ owner: 'link-assistant', repo: 'hive-mind', issueNumber: 1596, $: async () => ({ code: 0, stdout: JSON.stringify({ issueType: null }) }) }), null);
assert.equal(await fetchIssueType({ owner: 'link-assistant', repo: 'hive-mind', issueNumber: 1596 }), null);

const promptParams = {
  owner: 'link-assistant',
  repo: 'hive-mind',
  issueNumber: 1596,
  prNumber: 1996,
  branchName: 'issue-1596-17953fa6e3af',
  workspaceTmpDir: null,
  argv: { developmentLog: true },
  modelSupportsVision: false,
  forkedRepo: null,
  issueUrl: 'https://github.com/link-assistant/hive-mind/issues/1596',
  tempDir: '/tmp/hive-mind',
  isContinueMode: false,
  feedbackLines: [],
};

const promptBuilders = {
  agent: { system: buildAgentSystemPrompt, user: buildAgentUserPrompt },
  claude: { system: buildClaudeSystemPrompt, user: buildClaudeUserPrompt },
  codex: { system: buildCodexSystemPrompt, user: buildCodexUserPrompt },
  gemini: { system: buildGeminiSystemPrompt, user: buildGeminiUserPrompt },
  opencode: { system: buildOpenCodeSystemPrompt, user: buildOpenCodeUserPrompt },
  qwen: { system: buildQwenSystemPrompt, user: buildQwenUserPrompt },
};

for (const [tool, builders] of Object.entries(promptBuilders)) {
  const userPrompt = builders.user(promptParams);
  const systemPrompt = builders.system(promptParams);
  assert.ok(userPrompt.includes('./dev/log/issues/1596/pulls/1996'), `${tool} user prompt should include the development-log directory`);
  assert.ok(!systemPrompt.includes('./dev/log/issues/1596/pulls/1996'), `${tool} system prompt must not include the development-log instruction`);
  assert.ok(!userPrompt.includes('Keep available tool session files'), `${tool} prompt must not delegate session persistence to the agent`);
  assert.ok(!userPrompt.includes('Commit the collected development-log files'), `${tool} prompt must not delegate log commits to the agent`);
  assert.ok(!userPrompt.includes('./docs/case-studies/issue-1596'), `${tool} prompt must contain only the issue-requested collection sentence`);
}

const tempRoot = await mkdtemp(join(tmpdir(), 'hive-development-log-'));
try {
  const repositoryPath = join(tempRoot, 'repo');
  const sourceLog = join(tempRoot, 'solve.log');
  await mkdir(repositoryPath, { recursive: true });
  await writeFile(sourceLog, 'raw solve log\n', 'utf8');

  const result = await writeDevelopmentLogArtifacts({
    repositoryPath,
    logFile: sourceLog,
    issueNumber: 1596,
    prNumber: 1996,
    tool: 'codex',
    sessionId: 'codex-session-123',
    branchName: 'issue-1596-17953fa6e3af',
    rawCommand: 'solve https://github.com/link-assistant/hive-mind/issues/1596 --development-log',
    now: new Date('2026-06-28T12:00:00.000Z'),
  });

  assert.equal(result.relativeDirectory, 'dev/log/issues/1596/pulls/1996');
  assert.equal(result.sessionRelativeDirectory, 'dev/log/issues/1596/pulls/1996/sessions/codex-session-123');
  assert.equal(result.copiedLogRelativePath, 'dev/log/issues/1596/pulls/1996/sessions/codex-session-123/solve.log');

  const copiedLog = await readFile(join(repositoryPath, result.copiedLogRelativePath), 'utf8');
  assert.equal(copiedLog, 'raw solve log\n');

  const metadata = JSON.parse(await readFile(join(repositoryPath, result.metadataRelativePath), 'utf8'));
  assert.equal(metadata.schemaVersion, 2);
  assert.equal(metadata.tool, 'codex');
  assert.equal(metadata.sessionId, 'codex-session-123');
  assert.equal(metadata.developmentLogDirectory, './dev/log/issues/1596/pulls/1996');
  assert.equal(metadata.caseStudyDirectory, './docs/case-studies/issue-1596');
  assert.equal(metadata.artifacts.solveLog, './dev/log/issues/1596/pulls/1996/sessions/codex-session-123/solve.log');

  // Issue #1596: codex rollout transcripts are discovered under ~/.codex/sessions
  // (rollout-<timestamp>-<sessionId>.jsonl) and copied into the development log.
  const fakeHome = join(tempRoot, 'home');
  const codexSessionsDir = join(fakeHome, '.codex', 'sessions', '2026', '06', '28');
  await mkdir(codexSessionsDir, { recursive: true });
  await writeFile(join(codexSessionsDir, 'rollout-2026-06-28T12-00-00-codex-session-123.jsonl'), '{"type":"session"}\n', 'utf8');
  const codexResult = await writeDevelopmentLogArtifacts({
    repositoryPath: join(tempRoot, 'codex-repo'),
    logFile: null,
    issueNumber: 1596,
    prNumber: 1996,
    tool: 'codex',
    sessionId: 'codex-session-123',
    branchName: 'issue-1596-17953fa6e3af',
    rawCommand: 'solve --development-log',
    now: new Date('2026-06-28T12:00:00.000Z'),
    homeDir: fakeHome,
  });
  assert.ok(codexResult.sessionFiles.includes('./dev/log/issues/1596/pulls/1996/sessions/codex-session-123/codex-codex-session-123.jsonl'), 'codex rollout transcript should be copied into its UUID directory');
  const copiedCodex = await readFile(join(tempRoot, 'codex-repo', 'dev/log/issues/1596/pulls/1996/sessions/codex-session-123/codex-codex-session-123.jsonl'), 'utf8');
  assert.equal(copiedCodex, '{"type":"session"}\n');

  const claudeRepositoryPath = join(tempRoot, 'claude-repo');
  const claudeProjectDirectory = join(fakeHome, '.claude', 'projects', claudeRepositoryPath.replace(/\//g, '-'));
  await mkdir(claudeProjectDirectory, { recursive: true });
  await writeFile(join(claudeProjectDirectory, 'claude-session-456.jsonl'), '{"type":"assistant"}\n', 'utf8');
  const claudeResult = await writeDevelopmentLogArtifacts({
    repositoryPath: claudeRepositoryPath,
    logFile: null,
    issueNumber: 1596,
    prNumber: 1996,
    tool: 'claude',
    sessionId: 'claude-session-456',
    now: new Date('2026-06-28T12:00:00.000Z'),
    homeDir: fakeHome,
  });
  assert.ok(claudeResult.sessionFiles.includes('./dev/log/issues/1596/pulls/1996/sessions/claude-session-456/claude-claude-session-456.jsonl'), 'Claude transcript should be copied into its UUID directory');

  const fallbackResult = await writeDevelopmentLogArtifacts({
    repositoryPath: join(tempRoot, 'fallback-repo'),
    logFile: null,
    issueNumber: 1596,
    prNumber: 1996,
    tool: 'gemini',
    sessionId: null,
    now: new Date('2026-06-28T12:00:00.000Z'),
  });
  assert.equal(fallbackResult.sessionRelativeDirectory, 'dev/log/issues/1596/pulls/1996/sessions/run-2026-06-28T12-00-00-000Z');

  const calls = [];
  const fakeGit =
    ({ cwd }) =>
    async (strings, ...values) => {
      const command = strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, '');
      calls.push({ cwd, command });
      return { code: command.startsWith('git diff') ? 1 : 0, stdout: '', stderr: '' };
    };

  const commitResult = await collectAndCommitDevelopmentLogArtifacts({
    enabled: true,
    repositoryPath,
    logFile: sourceLog,
    issueNumber: 1596,
    prNumber: 1996,
    tool: 'codex',
    sessionId: 'codex-session-123',
    branchName: 'issue-1596-17953fa6e3af',
    rawCommand: 'solve https://github.com/link-assistant/hive-mind/issues/1596 --development-log',
    $: fakeGit,
    log: async () => {},
  });

  assert.equal(commitResult.committed, true);
  assert.equal(commitResult.pushed, true);
  assert.equal(calls[0].command, 'git add -f -- dev/log/issues/1596/pulls/1996');
  assert.equal(calls[1].command, 'git diff --cached --quiet -- dev/log/issues/1596/pulls/1996');
  assert.equal(calls[2].command, 'git commit -m Add development log for issue #1596 PR #1996 -- dev/log/issues/1596/pulls/1996');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('development-log option tests passed');
