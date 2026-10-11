#!/usr/bin/env node

/**
 * Regression coverage for issue #2843.
 *
 * solve.mjs declares its positional as `issue-url`, so `argv.url` is never set.
 * The failure path read `argv.url`, which printed an empty
 * "💡 To continue this session:" hint for every tool except claude and passed a
 * null resume command to the failure report and log upload. The codex, gemini,
 * agent, opencode and qwen adapters read the same missing field.
 *
 * These tests parse real CLI arguments (`<url> --tool codex`) and run the
 * failure-path builders on them.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArguments } from '../src/solve.config.lib.mjs';
import { buildFailureResumeHintLines, buildSolveResumeCommandFromArgv, resolveSolveIssueUrl } from '../src/solve.resume-command.lib.mjs';
import { showResumeCommand } from '../src/claude.resume-output.lib.mjs';

const ISSUE_URL = 'https://github.com/link-assistant/router/issues/717';
const SESSION_ID = '019a6b1c-codex-session';
const TEMP_DIR = '/tmp/gh-issue-solver-2843';
const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}\n   ${error.message}`);
    failed++;
  }
};

const parseSolveArgs = args => parseArguments(undefined, () => args);
// "<node>" "<solve>" "<url>" --resume "<session>" [flags] → exact url/session/flags, not substrings.
const parseResumeCommand = command => {
  const match = /^"[^"]*" "[^"]*" "([^"]*)" --resume "([^"]*)"(.*)$/.exec(command.trim());
  assert.ok(match, `not a solve resume command: ${command}`);
  return { url: match[1], sessionId: match[2], flags: match[3].trim() };
};
const SOLVE_RESUME_PREFIX = '   Solve resume mode:   ';

await test('parsed solve arguments expose the URL as issue-url, not url', async () => {
  const argv = await parseSolveArgs([ISSUE_URL, '--tool', 'codex']);
  assert.equal(argv.url, undefined, 'argv.url is not a solve option');
  assert.equal(argv['issue-url'], ISSUE_URL);
  assert.equal(resolveSolveIssueUrl(argv), ISSUE_URL);
});

await test('codex failure prints a solve resume command', async () => {
  const argv = await parseSolveArgs([ISSUE_URL, '--tool', 'codex', '--model', 'gpt-5.5']);
  const lines = buildFailureResumeHintLines({ argv, sessionId: SESSION_ID, tempDir: TEMP_DIR });
  const text = lines.join('\n');
  assert.ok(text.includes('💡 To continue this session:'), text);
  const resumeLine = lines.find(line => line.startsWith(SOLVE_RESUME_PREFIX));
  assert.ok(resumeLine, `missing "Solve resume mode" line in:\n${text}`);
  const resume = parseResumeCommand(resumeLine.slice(SOLVE_RESUME_PREFIX.length));
  assert.equal(resume.url, ISSUE_URL);
  assert.equal(resume.sessionId, SESSION_ID);
  const fallbackFlag = argv.fallbackModel ? ` --fallback-model "${argv.fallbackModel}"` : '';
  assert.equal(resume.flags, `--tool "codex" --model "gpt-5.5"${fallbackFlag} --working-directory "${TEMP_DIR}"`);
  assert.ok(!text.includes('Interactive mode:'), 'claude-only commands must not be shown for codex');
});

await test('codex failure records a non-null resume command', async () => {
  const argv = await parseSolveArgs([ISSUE_URL, '--tool', 'codex']);
  const resumeCommand = buildSolveResumeCommandFromArgv({ argv, sessionId: SESSION_ID, tempDir: TEMP_DIR });
  assert.ok(resumeCommand, 'resume command must not be null');
  const resume = parseResumeCommand(resumeCommand);
  assert.equal(resume.url, ISSUE_URL);
  assert.equal(resume.sessionId, SESSION_ID);
  assert.ok(resume.flags.startsWith('--tool "codex"'), resumeCommand);
});

await test('claude failure keeps interactive, autonomous and solve resume commands', async () => {
  const argv = await parseSolveArgs([ISSUE_URL]);
  const text = buildFailureResumeHintLines({ argv, sessionId: SESSION_ID, tempDir: TEMP_DIR }).join('\n');
  assert.ok(text.includes('Interactive mode:'), text);
  assert.ok(text.includes('Autonomous mode:'), text);
  const resumeLine = text.split('\n').find(line => line.startsWith(SOLVE_RESUME_PREFIX));
  assert.ok(resumeLine, text);
  assert.equal(parseResumeCommand(resumeLine.slice(SOLVE_RESUME_PREFIX.length)).url, ISSUE_URL);
  assert.ok(!text.includes('--tool'), 'claude is the default tool and is not repeated');
});

await test('no hint without a session', async () => {
  const argv = await parseSolveArgs([ISSUE_URL, '--tool', 'codex']);
  assert.deepEqual(buildFailureResumeHintLines({ argv, sessionId: null, tempDir: TEMP_DIR }), []);
  assert.equal(buildSolveResumeCommandFromArgv({ argv, sessionId: null, tempDir: TEMP_DIR }), null);
});

await test('agent, opencode, qwen and gemini resume commands keep the tool and URL', async () => {
  for (const tool of ['agent', 'opencode', 'qwen', 'gemini']) {
    const argv = await parseSolveArgs([ISSUE_URL, '--tool', tool]);
    const command = buildSolveResumeCommandFromArgv({ argv, sessionId: SESSION_ID, tempDir: TEMP_DIR, tool });
    const resume = parseResumeCommand(command);
    assert.equal(resume.url, ISSUE_URL);
    assert.equal(resume.sessionId, SESSION_ID);
    assert.ok(resume.flags.startsWith(`--tool "${tool}"`), command);
    assert.ok(!command.includes('undefined'), command);
  }
});

await test('claude adapter prints the solve resume command from parsed arguments', async () => {
  const argv = await parseSolveArgs([ISSUE_URL]);
  const logged = [];
  await showResumeCommand(SESSION_ID, TEMP_DIR, 'claude', null, async line => logged.push(line), argv);
  const resumeLine = logged.find(line => line.startsWith(SOLVE_RESUME_PREFIX));
  assert.ok(resumeLine, logged.join(''));
  assert.equal(parseResumeCommand(resumeLine.slice(SOLVE_RESUME_PREFIX.length)).url, ISSUE_URL);
});

await test('arguments of other commands do not produce a solve resume command', async () => {
  const reviewArgv = { _: ['https://github.com/link-assistant/router/pull/719'], 'pr-url': 'https://github.com/link-assistant/router/pull/719', tool: 'claude' };
  assert.equal(resolveSolveIssueUrl(reviewArgv), null);
  assert.equal(buildSolveResumeCommandFromArgv({ argv: reviewArgv, sessionId: SESSION_ID, tempDir: TEMP_DIR }), null);
});

await test('no source file reads the non-existent argv.url', async () => {
  const offenders = [];
  for (const entry of await readdir(srcDir, { recursive: true })) {
    if (!/\.(mjs|js|cjs)$/.test(entry)) continue;
    const source = await readFile(path.join(srcDir, entry), 'utf8');
    source.split('\n').forEach((line, index) => {
      if (/\bargv\??\.url\b/.test(line) && !line.trim().startsWith('*')) offenders.push(`src/${entry}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
