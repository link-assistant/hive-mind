/** Finite reproduction: a selected success resumes and finishes with a fresh failure. */
import assert from 'node:assert/strict';
import { removeDockerContainer } from '../../src/cleanup.docker.os.lib.mjs';
const name = 'e6c1dd3f-3acd-475d-8df4-f45b75879a8b';
const state = { running: false, restarting: false, pid: 0, exitCode: 1, finishedAt: '2026-10-07T17:59:00Z' };
const legacySelects = !state.running && !state.restarting && state.pid === 0;
assert.equal(legacySelects, true);
for (const mode of ['succeeded', 'failed-older-than=48h']) {
  let removed = false;
  const result = removeDockerContainer(name, {
    mode,
    now: Date.parse('2026-10-07T18:00:00Z'),
    execFn: (_cmd, args) => {
      if (args[0] === 'rm') {
        removed = true;
        return name;
      }
      return `false false 0 exited ${state.exitCode} ${state.finishedAt}`;
    },
  });
  assert.equal(result, false);
  assert.equal(removed, false);
  console.log(`${mode}: old state-only guard selects a fresh failure; current policy keeps it`);
}
