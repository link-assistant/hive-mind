#!/usr/bin/env node

/**
 * Regression coverage for the Hive-Mind-side false positives issue #2130 asks to
 * fix first ("we must fix all false positives, false negatives, warnings and
 * errors on Hive Mind side").
 *
 * Every case below is quoted from the logs attached to the issue and stored
 * under docs/case-studies/issue-2130/data/tool-logs/.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildAuthRemedyLines } from '../src/formal-ai.lib.mjs';
import { buildCodexRunDiagnostics, codexRunAlreadyFailed, describeCodexLastMessageOutcome } from '../src/codex.run-diagnostics.lib.mjs';
import { setupGitCredentialHelper } from '../src/solve.repo-setup.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- vendor login advice for a Formal-AI-served model -----------------------

test('buildAuthRemedyLines keeps the vendor remedy for a vendor model', () => {
  assert.deepEqual(buildAuthRemedyLines({ model: 'gpt-5', vendorRemedy: 'Please run: codex login' }), ['   💡 Please run: codex login']);
});

test('buildAuthRemedyLines replaces the vendor remedy for a Formal AI model', () => {
  // codex-02-rv2k7W.log: "❌ Codex authentication failed - 401 Unauthorized …
  // 💡 Please run: codex login" while the request had gone to api.openai.com.
  // Logging in to OpenAI cannot fix a run that is supposed to reach Formal AI.
  const lines = buildAuthRemedyLines({ model: 'formal-ai', vendorRemedy: 'Please run: codex login' });
  assert.ok(!lines.some(line => line.includes('codex login')), 'no vendor login is suggested');
  assert.ok(
    lines.some(line => line.includes('Formal AI')),
    'the remedy names Formal AI'
  );
  assert.ok(
    lines.some(line => line.includes('formal-ai serve')),
    'the remedy points at the server that must be reachable'
  );
});

test('every tool adapter routes its vendor login advice through buildAuthRemedyLines', async () => {
  for (const file of ['src/codex.lib.mjs', 'src/claude.lib.mjs']) {
    const source = await readFile(join(repoRoot, file), 'utf8');
    assert.ok(source.includes('buildAuthRemedyLines'), `${file} builds its remedy through the helper`);
    const code = source
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    assert.ok(!/log\('\s+💡 Please run: (codex|claude) login'/.test(code), `${file} has no hard-coded vendor login remedy left`);
  }
});

// --- consequences of a failed run must not be reported as new problems ------

test('codexRunAlreadyFailed recognises the signals a failed run leaves behind', () => {
  assert.equal(codexRunAlreadyFailed({ state: {}, exitCode: 0 }), false);
  assert.equal(codexRunAlreadyFailed({ state: {}, exitCode: 1 }), true);
  assert.equal(codexRunAlreadyFailed({ state: { turnFailures: [{}] }, exitCode: 0 }), true);
  assert.equal(codexRunAlreadyFailed({ state: { streamErrors: [{}] }, exitCode: null }), true);
  assert.equal(codexRunAlreadyFailed({ state: { authError: true } }), true);
});

test('describeCodexLastMessageOutcome does not warn when a failed run wrote no final message', () => {
  // codex-02-rv2k7W.log:752 — "⚠️ Could not read Codex final message file:
  // ENOENT" printed right after "codex exited with status 1".
  const outcome = describeCodexLastMessageOutcome({
    lastMessageFile: '/tmp/codex_last_message_1785685483185_1.txt',
    readError: Object.assign(new Error("ENOENT: no such file or directory, open '/tmp/codex_last_message_1785685483185_1.txt'"), { code: 'ENOENT' }),
    runFailed: true,
  });

  assert.equal(outcome.options.level, undefined, 'the expected consequence of a failure is not a warning');
  assert.match(outcome.message, /no final message file/);
});

test('describeCodexLastMessageOutcome still warns when a successful run wrote no final message', () => {
  const outcome = describeCodexLastMessageOutcome({
    lastMessageFile: '/tmp/codex_last_message.txt',
    readError: Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
    runFailed: false,
  });

  assert.equal(outcome.options.level, 'warning');
});

test('describeCodexLastMessageOutcome keeps warning about a read error that is not a missing file', () => {
  const outcome = describeCodexLastMessageOutcome({
    lastMessageFile: '/tmp/codex_last_message.txt',
    readError: Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    runFailed: true,
  });

  assert.equal(outcome.options.level, 'warning');
  assert.match(outcome.message, /EACCES/);
});

test('describeCodexLastMessageOutcome reports a captured final message', () => {
  const outcome = describeCodexLastMessageOutcome({ lastMessageFile: '/tmp/last.txt', lastMessage: 'done', runFailed: false });
  assert.equal(outcome.options.level, undefined);
  assert.match(outcome.message, /Final Codex message captured in \/tmp\/last\.txt/);
});

test('buildCodexRunDiagnostics does not warn about missing usage when the turn never completed', () => {
  // codex-02-rv2k7W.log:755 — "📈 No Codex usage found in turn.completed events"
  // logged as WARNING for a run whose only turn had already failed.
  const state = {
    eventCounts: { 'thread.started': 1, 'turn.failed': 1 },
    itemTypeCounts: { error: 2 },
    tokenUsage: { stepCount: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    itemErrors: [{}, {}],
    turnFailures: [{}],
    streamErrors: new Array(10).fill({}),
  };

  const lines = buildCodexRunDiagnostics({ state, exitCode: 1, mappedModel: 'formal-ai' });
  const usageLine = lines.find(line => line.message.startsWith('📈'));
  assert.equal(usageLine.options.level, undefined, 'a failed turn has no usage by definition');
  assert.match(usageLine.message, /never completed/);
  assert.equal(lines.filter(line => line.options.level === 'warning').length, 0, 'a single upstream failure produces no extra warnings');
});

test('buildCodexRunDiagnostics still warns about missing usage after a clean run', () => {
  const lines = buildCodexRunDiagnostics({ state: { tokenUsage: { stepCount: 0 } }, exitCode: 0, mappedModel: 'gpt-5' });
  const usageLine = lines.find(line => line.message.startsWith('📈'));
  assert.equal(usageLine.options.level, 'warning');
  assert.match(usageLine.message, /No Codex usage found in turn\.completed events/);
});

test('buildCodexRunDiagnostics reports the usage totals it does find', () => {
  const lines = buildCodexRunDiagnostics({
    state: { tokenUsage: { stepCount: 2, inputTokens: 7822, outputTokens: 183, cacheReadTokens: 0 } },
    exitCode: 0,
    mappedModel: 'formal-ai',
  });

  assert.ok(lines.some(line => line.message.includes('7,822 input')));
  assert.ok(lines.some(line => line.message.includes('across 2 turn(s)')));
});

// --- credential helper setup ------------------------------------------------

const createFakeShell = respond => {
  const calls = [];
  const tag = (strings, ...values) => {
    const command = String.raw({ raw: strings }, ...values);
    calls.push(command);
    return Promise.resolve(respond(command));
  };
  const shell = () => tag;
  shell.calls = calls;
  return shell;
};

const collectLogs = () => {
  const entries = [];
  return { entries, log: async (message, options = {}) => void entries.push({ message, options }) };
};

test('setupGitCredentialHelper uses the global gitconfig when gh can write it', async () => {
  const $ = createFakeShell(() => ({ code: 0 }));
  const { entries, log } = collectLogs();

  const result = await setupGitCredentialHelper({ tempDir: '/tmp/clone', log, $ });

  assert.equal(result.scope, 'global');
  assert.deepEqual($.calls, ['gh auth setup-git 2>&1']);
  assert.deepEqual(entries, []);
});

test('setupGitCredentialHelper falls back to the clone-local config when the global one is read-only', async () => {
  // agent-18-V7E0Ee.log: "failed to set up git credential helper: failed to run
  // git: error: could not write config file /home/box/.gitconfig: Device or
  // resource busy" — Hive Mind mirrored that raw and then ran with no helper.
  const $ = createFakeShell(command => (command.startsWith('gh auth setup-git') ? { code: 1, stdout: 'failed to set up git credential helper: failed to run git: error: could not write config file /home/box/.gitconfig: Device or resource busy\n' } : { code: 0 }));
  const { entries, log } = collectLogs();

  const result = await setupGitCredentialHelper({ tempDir: '/tmp/clone', log, $ });

  assert.equal(result.scope, 'local');
  assert.ok(
    $.calls.some(command => command.includes('git config --local --add credential.https://github.com.helper !gh auth git-credential')),
    'the gh credential helper is configured for this clone'
  );
  assert.ok(
    $.calls.some(command => command.includes('--replace-all credential.https://github.com.helper')),
    'any inherited helper is cleared first, as gh auth setup-git does'
  );
  assert.equal(entries.filter(entry => entry.options.level === 'warning').length, 0, 'a recoverable condition is not a warning');
  assert.ok(
    entries.every(entry => entry.options.verbose),
    'the explanation is verbose-only detail'
  );
});

test('setupGitCredentialHelper warns only when no credential helper could be configured at all', async () => {
  const $ = createFakeShell(() => ({ code: 1, stdout: 'nope' }));
  const { entries, log } = collectLogs();

  const result = await setupGitCredentialHelper({ tempDir: '/tmp/clone', log, $ });

  assert.deepEqual(result, { scope: 'none', hosts: ['github.com'] });
  const warnings = entries.filter(entry => entry.options.level === 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /pushes may require credentials in the remote URL/);
});

// --- probes must not mirror their raw `gh` output ---------------------------

test('checkFileInBranch runs its existence probe silently', async () => {
  // claude-02-FTn7sm.log:84,86 — two bare "gh: Not Found (HTTP 404)" lines that
  // are the *expected* answer of a probe, plus the full contents JSON on a hit.
  const source = await readFile(join(repoRoot, 'src', 'github.lib.mjs'), 'utf8');
  assert.match(source, /\$\(\{ mirror: false, capture: true \}\)`gh api repos\/\$\{owner\}\/\$\{repo\}\/contents/, 'the contents probe does not mirror gh output');
});
