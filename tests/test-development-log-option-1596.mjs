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
import { buildSystemPrompt as buildAgentSystemPrompt } from '../src/agent.prompts.lib.mjs';
import { buildSystemPrompt as buildClaudeSystemPrompt } from '../src/claude.prompts.lib.mjs';
import { buildSystemPrompt as buildCodexSystemPrompt } from '../src/codex.prompts.lib.mjs';
import { buildSystemPrompt as buildGeminiSystemPrompt } from '../src/gemini.prompts.lib.mjs';
import { buildSystemPrompt as buildOpenCodeSystemPrompt } from '../src/opencode.prompts.lib.mjs';
import { buildSystemPrompt as buildQwenSystemPrompt } from '../src/qwen.prompts.lib.mjs';

const option = SOLVE_OPTION_DEFINITIONS['development-log'];
assert.ok(option, '--development-log should be defined');
assert.equal(option.type, 'boolean');
assert.equal(option.default, false);

assert.ok(getSolvePassthroughOptionNames().includes('development-log'), '--development-log should pass through hive');

const developmentLog = await import('../src/development-log.lib.mjs');
const { buildDevelopmentLogDirectory, buildCaseStudyDirectory, buildDevelopmentLogPrompt, writeDevelopmentLogArtifacts, collectAndCommitDevelopmentLogArtifacts } = developmentLog;

assert.equal(buildDevelopmentLogDirectory({ issueNumber: 1596, prNumber: 1996 }), './dev/log/issues/1596/pulls/1996');
assert.equal(buildDevelopmentLogDirectory({ issueNumber: 1596, prNumber: null }), './dev/log/issues/1596/pulls/pending');
assert.equal(buildCaseStudyDirectory({ issueNumber: 1596 }), './docs/case-studies/issue-1596');
assert.equal(buildDevelopmentLogPrompt({ argv: {}, issueNumber: 1596, prNumber: 1996 }), '');
const developmentLogPrompt = buildDevelopmentLogPrompt({ argv: { 'development-log': true }, issueNumber: 1596, prNumber: 1996 });
assert.ok(developmentLogPrompt.includes('./dev/log/issues/1596/pulls/1996'));
assert.ok(developmentLogPrompt.includes('Bug issues: Download all logs and collect data related about the issue to this repository'));
assert.ok(developmentLogPrompt.includes('Feature, task, and unspecified issues: Collect data related about the issue to this repository'));

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
};

const promptBuilders = {
  agent: buildAgentSystemPrompt,
  claude: buildClaudeSystemPrompt,
  codex: buildCodexSystemPrompt,
  gemini: buildGeminiSystemPrompt,
  opencode: buildOpenCodeSystemPrompt,
  qwen: buildQwenSystemPrompt,
};

for (const [tool, buildPrompt] of Object.entries(promptBuilders)) {
  const prompt = buildPrompt(promptParams);
  assert.ok(prompt.includes('Development log.'), `${tool} prompt should include the development-log section`);
  assert.ok(prompt.includes('./dev/log/issues/1596/pulls/1996'), `${tool} prompt should include the development-log directory`);
  assert.ok(prompt.includes('./docs/case-studies/issue-1596'), `${tool} prompt should include the case-study directory`);
  assert.ok(prompt.includes('Commit the collected development-log files'), `${tool} prompt should require committing the development log`);
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
  assert.ok(result.copiedLogRelativePath.startsWith('dev/log/issues/1596/pulls/1996/sessions/solve-'));

  const copiedLog = await readFile(join(repositoryPath, result.copiedLogRelativePath), 'utf8');
  assert.equal(copiedLog, 'raw solve log\n');

  const metadata = JSON.parse(await readFile(join(repositoryPath, result.metadataRelativePath), 'utf8'));
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.tool, 'codex');
  assert.equal(metadata.sessionId, 'codex-session-123');
  assert.equal(metadata.developmentLogDirectory, './dev/log/issues/1596/pulls/1996');
  assert.equal(metadata.caseStudyDirectory, './docs/case-studies/issue-1596');
  assert.equal(metadata.artifacts.solveLog, './dev/log/issues/1596/pulls/1996/sessions/solve-2026-06-28T12-00-00-000Z.log');

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
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('development-log option tests passed');
