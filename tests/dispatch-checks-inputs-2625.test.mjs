/**
 * Regression coverage for issue #2625 (Formal AI Draft runs 37204604042 …
 * 37628867214, step "Dispatch checks on the draft head").
 *
 * With the default token a pull request does not trigger workflows, so the
 * draft job dispatches its checks with `gh workflow run <wf> -f mode=checks`.
 * release.yml declared `bump_type` as `required: true` without a default, and
 * GitHub's dispatch API refuses that outright:
 *
 *   HTTP 422: Required input 'bump_type' not provided
 *
 * No checks dispatch of release.yml has ever started; the step failed on
 * every attempt. A required input without a default can only be dispatched
 * from the web form, so every workflow dispatch-checks may start must accept
 * `mode` and need nothing else.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/** `on.workflow_dispatch.inputs` as `{ name: { required, default } }`, read by indentation. */
const dispatchInputs = workflow => {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => /^ {2}workflow_dispatch:/.test(line));
  if (start < 0) return null;
  const inputs = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break;
    const name = line.match(/^ {6}([\w-]+):\s*$/);
    if (name) inputs[(current = name[1])] = {};
    const field = line.match(/^ {8}(required|default):\s*(.*?)\s*$/);
    if (current && field) inputs[current][field[1]] = field[2];
  }
  return inputs;
};

const dispatchedWorkflows = () => {
  const allowed = read('scripts/dispatch-checks.mjs').match(/const allowed = new Set\(\[([^\]]+)\]\)/)[1];
  return [...allowed.matchAll(/'([^']+)'/g)].map(match => match[1]);
};

test('the dispatch-checks action defaults only to workflows the script allows', () => {
  const defaults = read('.github/actions/dispatch-checks/action.yml')
    .match(/default: '([^']+\.yml[^']*)'/)[1]
    .split(/\s+/);
  assert.deepEqual(
    defaults.filter(workflow => !dispatchedWorkflows().includes(workflow)),
    []
  );
});

test('the dispatch passes mode=checks and nothing else', () => {
  assert.match(read('scripts/dispatch-checks.mjs'), /'--ref', ref, '-f', 'mode=checks'\]\)/);
});

for (const workflow of dispatchedWorkflows()) {
  test(`${workflow} can be dispatched with only mode=checks`, () => {
    const inputs = dispatchInputs(read(`.github/workflows/${workflow}`));
    assert.ok(inputs, `${workflow} has a workflow_dispatch trigger`);
    assert.ok(inputs.mode, `${workflow} declares the mode input`);
    const unsatisfiable = Object.entries(inputs)
      .filter(([name, input]) => name !== 'mode' && input.required === 'true' && input.default === undefined)
      .map(([name]) => name);
    assert.deepEqual(unsatisfiable, [], `${workflow}: GitHub answers HTTP 422 "Required input '<name>' not provided" for these`);
  });
}

test('the parser sees the inputs a manual release still needs', () => {
  const inputs = dispatchInputs(read('.github/workflows/release.yml'));
  assert.deepEqual(Object.keys(inputs), ['mode', 'release_mode', 'bump_type', 'description']);
  assert.equal(inputs.release_mode.default, "'checks'");
});
