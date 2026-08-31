#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Test for issue #2047: "Investigate the reason for rejection".
 *
 * Root cause B1 (see docs/case-studies/issue-2047): a `solve --tool codex` run against a
 * heavily-reviewed PR was launched with the default `--think off`, so Codex ran with
 * `model_reasoning_effort="none"` on every turn (100 occurrences in the captured log). With
 * reasoning disabled, GPT-5.6 Sol gave up after ~2 minutes ("I wasn't able to complete ... the
 * branch remains unchanged") and no work was done.
 *
 * The reasoning effort was only discoverable by digging through Codex telemetry. This test
 * guards the fix: (1) the default reasoning effort really is `none` (the trigger condition),
 * and (2) codex.lib.mjs surfaces a visible "Low reasoning" warning for that case so the run is
 * diagnosable at a glance.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { resolveCodexReasoningEffort } = await import('../src/codex.options.lib.mjs');

// (1) Trigger condition: omitting --think (or --think off) resolves to `none`.
assert.deepEqual(resolveCodexReasoningEffort({ think: 'off' }), {
  reasoningEffort: 'none',
  source: '--think off',
});
assert.equal(resolveCodexReasoningEffort({}).reasoningEffort, 'none', 'default reasoning effort must be none');

// (2) codex.lib.mjs emits a visible low-reasoning warning guarded on reasoningEffort === 'none'.
const here = path.dirname(fileURLToPath(import.meta.url));
const codexLib = readFileSync(path.join(here, '..', 'src', 'codex.lib.mjs'), 'utf8');

assert.match(codexLib, /reasoningEffort === 'none'/, 'codex.lib.mjs must guard the warning on the none case');
assert.match(codexLib, /Low reasoning/, 'codex.lib.mjs must surface a "Low reasoning" warning');
assert.match(codexLib, /--think medium\/high\/max/, 'the warning must point operators at higher --think levels');

console.log('Issue #2047 codex low-reasoning warning tests passed.');
