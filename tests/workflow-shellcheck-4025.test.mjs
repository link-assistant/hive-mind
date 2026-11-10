#!/usr/bin/env node
// @hive-mind-test-suite default,pr-essential

/**
 * Issue #4025: actionlint checks only the shell inside `run:` blocks, so the
 * standalone scripts and git hooks went unchecked and collected ShellCheck
 * errors (SC2148: no shebang in .husky/pre-commit and gitpod-*-auth.sh) and a
 * warning (SC2010 in scripts/verify-docker-image.sh). The Workflows check now
 * runs ShellCheck on them. This test keeps the job wired up and catches the
 * most common regression (a script without a shebang) without needing a
 * shellcheck binary.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const workflow = readFileSync('.github/workflows/workflows.yml', 'utf8').replaceAll('\r\n', '\n');

const job = workflow.match(/\n {2}shellcheck:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/);
assert.ok(job, 'workflows.yml has a shellcheck job');
assert.match(job[1], /timeout-minutes: \d+/, 'the shellcheck job has a timeout');
assert.match(job[1], /persist-credentials: false/, 'the shellcheck checkout holds no credentials');
assert.match(job[1], /pip" install [^\n]*shellcheck-py==\d+\.\d+\.\d+\.\d+\n/, 'shellcheck is pinned');
assert.match(job[1], /xargs -0 "\$RUNNER_TEMP\/shellcheck\/bin\/shellcheck" -S warning/, 'the pinned shellcheck runs by path and fails on warnings');
// Issue #4029: `pipx run` printed "shellcheck is already on your PATH" on every run.
assert.doesNotMatch(job[1], /^ *[^#\n ][^\n]*pipx run/mu, 'no pipx PATH notice');
assert.match(job[1], /git ls-files -z '\*\.sh' '\.husky\/\*'/, 'shellcheck reads every tracked script and hook');

for (const event of ['push', 'pull_request']) {
  const block = workflow.match(new RegExp(`\\n {2}${event}:\\n([\\s\\S]*?)(?=\\n {2}[a-z_]+:)`));
  assert.ok(block, `workflows.yml has a ${event} trigger`);
  assert.match(block[1], /- '\*\*\.sh'/, `${event} runs the checks when a shell script changes`);
  assert.match(block[1], /- '\.husky\/\*\*'/, `${event} runs the checks when a git hook changes`);
}

const files = execFileSync('git', ['ls-files', '-z', '*.sh', '.husky/*', ':!:experiments/**', ':!:docs/case-studies/**', ':!:dev/**'], { encoding: 'utf8' })
  .split('\0')
  .filter(file => file && !file.startsWith('.husky/_'));
assert.ok(files.length > 0, 'there are shell scripts to check');
const missing = files.filter(file => {
  const head = readFileSync(file, 'utf8').split('\n', 3).join('\n');
  return !head.startsWith('#!') && !/# shellcheck shell=/.test(head);
});
assert.deepEqual(missing, [], 'every checked script names its shell (ShellCheck SC2148)');

console.log(`workflow-shellcheck-4025.test.mjs: shellcheck job wired up; ${files.length} scripts name their shell`);
