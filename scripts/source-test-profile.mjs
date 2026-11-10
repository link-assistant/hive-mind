#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Select only existing profiles from the trusted Actions event context.
 *
 * Both profiles run the whole default unit suite. Issue #4025: pull requests
 * used to run a 13-file `pr-essential` subset, so regressions in the other
 * ~690 files were first seen on main (runs 41801786544 and 42570340658), and
 * main stopped at the first failing file, hiding the rest. The profiles now
 * differ only in what follows the unit suite: real GitHub integration runs in
 * the `default` (default-branch) lane alone.
 */
export function selectSourceTestProfile({ eventName, currentRef, defaultBranch }) {
  if (typeof defaultBranch !== 'string' || !defaultBranch || /\s|\p{Cc}/u.test(defaultBranch)) throw new Error('Missing or invalid repository default branch');
  if (eventName === 'pull_request') return 'pull-request';
  if (eventName === 'workflow_dispatch' && typeof currentRef === 'string' && currentRef.startsWith('refs/heads/') && currentRef !== 'refs/heads/' + defaultBranch) return 'pull-request';
  return 'default';
}

/** Every failing file is reported in one run, not just the first. */
export function sourceTestCommand(suite) {
  if (suite === 'default') return { command: 'npm', args: ['test', '--', '--continue-on-failure'] };
  if (suite === 'pull-request') return { command: process.execPath, args: ['scripts/run-tests.mjs', '--suite', 'default', '--continue-on-failure'] };
  throw new Error('Unsupported source test suite');
}

/** Write fixed selection before the child; no arbitrary command or checkout input. */
export function runSourceTestSuite(env = process.env, run = spawnSync) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const suite = selectSourceTestProfile({ eventName: env.GITHUB_EVENT_NAME, currentRef: env.GITHUB_REF, defaultBranch: event.repository?.default_branch });
  if (!env.GITHUB_OUTPUT || !env.GITHUB_ENV) throw new Error('Missing Actions output paths');
  appendFileSync(env.GITHUB_OUTPUT, 'suite=' + suite + '\n');
  appendFileSync(env.GITHUB_ENV, 'TEST_SUITE=' + suite + '\n');
  const { command, args } = sourceTestCommand(suite);
  const result = run(command, args, { stdio: 'inherit', env: { ...env, TEST_SUITE: suite } });
  if (result?.error) throw result.error;
  if (result?.signal || !Number.isInteger(result?.status) || result.status < 0 || result.status > 255) throw new Error('Source test child did not exit normally');
  return result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = runSourceTestSuite();
