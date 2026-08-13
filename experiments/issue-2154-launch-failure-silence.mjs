#!/usr/bin/env node

/**
 * Issue #2154 reproduction: how silent a refused launch used to be.
 *
 * Run it against the pre-fix tree and against the fixed tree:
 *
 * ```bash
 * git stash push -- src/            # pre-fix
 * node experiments/issue-2154-launch-failure-silence.mjs
 * git stash pop                     # fixed
 * node experiments/issue-2154-launch-failure-silence.mjs
 * ```
 *
 * Pre-fix output:  `stderr lines: 0` — the refusal existed only in the value
 * returned to Telegram, which is exactly the reported symptom ("in logs of
 * telegram bot there [is] nothing about it").
 * Post-fix output: one line per refusing layer, each naming the session UUID.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 */

import { acquireFormalAiSidecarForTask } from '../src/formal-ai-isolation.lib.mjs';
import { executeWithIsolation } from '../src/isolation-runner.lib.mjs';

const SESSION = '08ec853a-158a-4314-83e9-c6365670fe4c';

const captured = [];
const originalError = console.error;
console.error = (...args) => {
  captured.push(args.map(String).join(' '));
  originalError(...args);
};

console.log('--- layer 1: the Formal AI sidecar gate');
const gate = await acquireFormalAiSidecarForTask({
  backend: 'docker',
  args: ['--model', 'formal-ai'],
  model: 'formal-ai',
  sessionId: SESSION,
  env: { HIVE_MIND_FORMAL_AI_SIDECAR: '1' },
  acquire: async () => {
    throw new Error("Command failed: docker run --detach --name hive-mind-formal-ai …\nUnable to find image 'ghcr.io/link-assistant/formal-ai:0.339.1' locally\ndocker: Error response from daemon: error from registry: unauthorized");
  },
});
console.log('returned to caller:', JSON.stringify(gate.error));

console.log('\n--- layer 2: the isolation runner');
const launch = await executeWithIsolation('solve', ['https://github.com/o/r/issues/1'], { backend: 'not-a-backend', sessionId: SESSION, tool: 'codex', model: 'formal-ai' });
console.log('returned to caller:', JSON.stringify(launch.error));

console.error = originalError;
console.log(`\nstderr lines: ${captured.length}`);
console.log(`stderr lines naming the session UUID: ${captured.filter(line => line.includes(SESSION)).length}`);
