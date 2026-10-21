/**
 * Issue #3630: the oracles that judged run 39505806192's codex row a failure
 * although its program printed exactly `Hello, World!` and its diff held only
 * the answer plus what solve commits about its own session.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkDiffShape, logPrintsHelloWorld } from '../scripts/e2e-hello-world.lib.mjs';

// The pull request files of that row (pulls/3622/files), session UUID shortened.
const CODEX_FILES = ['ci/test-hello-world.yml', 'dev/log/issues/3620/pulls/3622/sessions/0199/metadata.json', 'dev/log/issues/3620/pulls/3622/sessions/0199/solve.log', 'dev/log/self-authored/issue-3620/evidence/codex-stream.jsonl', 'dev/log/self-authored/issue-3620/evidence/session-id.txt', 'main.rs', 'tests/verify-output.sh'];

// Lines of that row's act JSON log: the raw output keeps the program's newline.
const ACT_LOG = ['{"dryrun":false,"job":"Run main.rs/run","jobID":"run","level":"info","matrix":{},"msg":"⭐ Run Main sh tests/verify-output.sh\\n","stage":"Main","step":"sh tests/verify-output.sh\\n","stepID":["2"],"time":"2026-10-20T22:28:58Z"}', '{"dryrun":false,"job":"Run main.rs/run","jobID":"run","level":"info","matrix":{},"msg":"Hello, World!\\n","raw_output":true,"stage":"Main","step":"sh tests/verify-output.sh\\n","stepID":["2"],"time":"2026-10-20T22:28:58Z"}', '{"dryrun":false,"job":"Run main.rs/run","jobID":"run","level":"info","matrix":{},"msg":"  ✅  Success - Main sh tests/verify-output.sh\\n [97.814727ms]","stage":"Main","step":"sh tests/verify-output.sh\\n","stepID":["2"],"stepResult":"success","time":"2026-10-20T22:28:58Z"}'].join('\n');

test('act raw output with a trailing newline counts as the exact line', () => {
  assert.equal(logPrintsHelloWorld(ACT_LOG), true);
  assert.equal(logPrintsHelloWorld('{"msg":"Hello, World!\\r\\n","raw_output":true}'), true);
});

test('a JSON message still has to be exactly the line', () => {
  assert.equal(logPrintsHelloWorld('{"msg":"Expected: Hello, World!\\n"}'), false);
  assert.equal(logPrintsHelloWorld('{"msg":"Hello, World!!\\n"}'), false);
  assert.equal(logPrintsHelloWorld('{"msg":"echo Hello, World! \\n"}'), false);
});

test("solve's development log and self-authored evidence are not part of the answer", () => {
  const shape = checkDiffShape(CODEX_FILES, { workflowDir: 'ci/' });
  assert.equal(shape.ok, true, shape.reason);
  assert.match(shape.reason, /^3 files: ci\/test-hello-world\.yml, main\.rs, tests\/verify-output\.sh$/);
});

test('only the solve-owned roots are exempt', () => {
  assert.equal(checkDiffShape(['main.rs', 'ci/a.yml', 'dev/log/notes.md', 'helper.rs'], { workflowDir: 'ci/' }).ok, false, 'an arbitrary dev/log file is still counted');
  assert.equal(checkDiffShape(['main.rs', 'ci/a.yml', 'dev/log/issues/x/pulls/1/a', 'helper.rs'], { workflowDir: 'ci/' }).ok, false, 'the issue segment must be a number');
  assert.equal(checkDiffShape(['dev/log/self-authored/issue-1/evidence/a.txt', 'ci/a.yml'], { workflowDir: 'ci/' }).ok, false, 'evidence alone is no program');
});
