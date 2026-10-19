#!/usr/bin/env node
/**
 * Issue #2843: the solve failure path built its resume hint from `argv.url`, which
 * yargs never sets (the positional is `issue-url`). Non-Claude tools therefore
 * printed an empty "To continue this session" block and recorded no resume command.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2843
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArguments } from '../src/solve.config.lib.mjs';
import { resolveSolveIssueUrl, buildSolveResumeCommandFromArgv } from '../src/solve.resume-command.lib.mjs';

const ISSUE_URL = 'https://github.com/link-assistant/router/issues/717';
const SESSION = '019a2b3c-0000-7000-8000-000000000717';
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('the parsed solve argv has no `url` key; the issue URL is read from `issue-url`', async () => {
  const argv = await parseArguments(undefined, () => [ISSUE_URL, '--tool', 'codex']);
  assert.equal(argv.url, undefined);
  assert.equal(resolveSolveIssueUrl(argv), ISSUE_URL);
});

test('a failed --tool codex run gets a solve resume command with the URL, session and tool', async () => {
  const argv = await parseArguments(undefined, () => [ISSUE_URL, '--tool', 'codex', '--model', 'gpt-5.5']);
  const command = buildSolveResumeCommandFromArgv({ argv, sessionId: SESSION, tempDir: '/tmp/gh-issue-solver-1' });
  assert.ok(command, 'resume command must not be null');
  assert.match(command, new RegExp(`"${ISSUE_URL.replace(/[.]/g, '\\.')}" --resume "${SESSION}"`));
  assert.match(command, /--tool "codex"/);
  assert.match(command, /--model "gpt-5\.5"/);
  assert.match(command, /--working-directory "\/tmp\/gh-issue-solver-1"/);
});

test('the resolved issue URL of the run wins over argv, and a missing session gives no command', () => {
  const normalized = 'https://github.com/o/r/issues/1';
  assert.match(buildSolveResumeCommandFromArgv({ argv: { _: ['o/r#1'], tool: 'qwen' }, issueUrl: normalized, sessionId: SESSION }), /"https:\/\/github\.com\/o\/r\/issues\/1" --resume/);
  assert.equal(buildSolveResumeCommandFromArgv({ argv: { 'issue-url': normalized }, sessionId: null }), null);
  assert.equal(buildSolveResumeCommandFromArgv({ argv: {}, sessionId: SESSION }), null);
  assert.equal(resolveSolveIssueUrl({ _: [normalized] }), normalized);
  assert.equal(resolveSolveIssueUrl(undefined), null);
});

test('no source file reads the never-set argv.url', () => {
  const offenders = [];
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.mjs')) continue;
    const lines = readFileSync(join(srcDir, name), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (/\bargv\??\.url\b/.test(line) && !/^\s*(\*|\/\/)/.test(line)) offenders.push(`${name}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
