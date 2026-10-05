/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeCodexCommand } from '../src/codex.lib.mjs';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-native-effort-2526-'));
const previousHotLoad = process.env.HIVE_MIND_MODELS_HOT_LOAD;
const previousStateDir = process.env.HIVE_MIND_STATE_DIR;
process.env.HIVE_MIND_MODELS_HOT_LOAD = '0';
process.env.HIVE_MIND_STATE_DIR = path.join(workspace, 'state');
const events = [{ type: 'thread.started', thread_id: 'effort-regression' }, { type: 'turn.started' }, { type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }].map(event => JSON.stringify(event)).join('\n');

try {
  for (const [model, resume, expected] of [
    ['gpt-6.1-sol', null, 'low'],
    ['gpt-6.1-sol', 'existing-session', 'low'],
    ['gpt-6-sol', null, 'none'],
    ['unknown-coder', null, null],
  ]) {
    const commands = [];
    const fakeDollar =
      () =>
      (strings, ...values) => {
        commands.push(strings.reduce((result, part, index) => result + part + (values[index] ?? ''), ''));
        return {
          async *stream() {
            yield { type: 'stdout', data: Buffer.from(events) };
            yield { type: 'exit', code: 0 };
          },
        };
      };
    const result = await executeCodexCommand({
      tempDir: workspace,
      branchName: 'reasoning-test',
      prompt: 'test',
      systemPrompt: '',
      argv: { model, resume, think: 'off', verbose: false, baseBranch: '' },
      log: async () => {},
      formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  available', load: '0.00' }),
      feedbackLines: [],
      codexPath: 'codex',
      $: fakeDollar,
      calculatePricing: async () => null,
    });
    assert.equal(result.success, true);
    assert.equal(commands.length, 1);
    if (expected) assert.ok(commands[0].includes(`model_reasoning_effort=${expected}`));
    else assert.ok(!commands[0].includes('model_reasoning_effort='));
    if (resume) assert.ok(commands[0].includes('exec resume'));
  }
} finally {
  if (previousHotLoad === undefined) delete process.env.HIVE_MIND_MODELS_HOT_LOAD;
  else process.env.HIVE_MIND_MODELS_HOT_LOAD = previousHotLoad;
  if (previousStateDir === undefined) delete process.env.HIVE_MIND_STATE_DIR;
  else process.env.HIVE_MIND_STATE_DIR = previousStateDir;
  fs.rmSync(workspace, { recursive: true, force: true });
}
console.log('Issue #2526 native Codex new/resume command tests passed.');
