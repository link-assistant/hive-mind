/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { codexCodeModeHostFailure } from '../src/codex-code-mode-failure.lib.mjs';
import { executeCodexCommand, getCodexErrorEventSummary, parseCodexExecJsonOutput } from '../src/codex.lib.mjs';
import { classifyTaskFailure } from '../src/task-failure-signature.lib.mjs';

const incident = await readFile(new URL('../docs/case-studies/issue-4173/codex-events.ndjson', import.meta.url), 'utf8');
const [failedCell, completedTurn] = incident.trimEnd().split('\n');

test('solve fails the first time Codex reports required Code Mode unavailable, even at exit zero', async () => {
  let invocations = 0;
  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-4173',
    prompt: 'Run one cell',
    systemPrompt: '',
    argv: { model: 'gpt-5.5', verbose: false },
    log: async () => {},
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    feedbackLines: [],
    codexPath: 'codex',
    $: () => () => ({
      async *stream() {
        invocations++;
        yield { type: 'stdout', data: Buffer.from(incident) };
        yield { type: 'exit', code: 0 };
      },
    }),
    calculatePricing: async () => null,
  });
  assert.equal(result.success, false);
  assert.equal(result.result, codexCodeModeHostFailure);
  assert.equal(invocations, 1);
});

test('a completed turn can recover from optional Code Mode fallback or an echoed diagnostic', () => {
  const warning = JSON.parse(failedCell);
  warning.item.message = 'Code Mode is unavailable because the host could not start. Falling back to direct tools.';
  const output = `${JSON.stringify(warning)}\n${completedTurn}\n`;
  const state = parseCodexExecJsonOutput(output);
  parseCodexExecJsonOutput(`${failedCell}\n`, state, null, { source: 'stderr' });
  const summary = getCodexErrorEventSummary(state);
  assert.equal(summary.hasError, false);
  assert.equal(summary.ignoredCounts.item, 1);
});

test('task reports preserve the cause from direct solve, mergeability restarts, and resumed sessions', () => {
  const classify = (text, overrides) => classifyTaskFailure({ exitCode: 1, ...overrides }, text);
  assert.equal(classify(`❌ CODEX execution failed with ${codexCodeModeHostFailure}`), 'codex-code-mode-host');
  for (const [controller, reason] of [
    ['`--auto-restart`', 'tool_failure'],
    ['the automation', 'tool_failure_after_resume'],
  ]) {
    const terminal = `❌ AI session failed (${reason})`;
    const log = [`❌ The AI session failed and ${controller} stopped (${reason}).`, `   ${codexCodeModeHostFailure}`, terminal, '❌ Error: solve exited with code 1'].map(line => `2026-11-26T19:55:52.488697266Z [2026-11-26T19:55:52.484Z] [ERROR] ${line}`).join('\n');
    assert.equal(classify(log), 'codex-code-mode-host');
    assert.equal(classify(log, { oomKilled: true }), undefined);
    assert.equal(classify(`${failedCell}\n${terminal}`), 'tool-failure');
  }
});
