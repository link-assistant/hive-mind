#!/usr/bin/env node
/**
 * Issue #2189 — verify Hive Mind's `$ --resume` / `$ --resume-all` wrappers
 * against a real `start-command` binary.
 *
 * The wrappers in src/isolation-runner.resume.lib.mjs consume upstream verbs
 * added in start-command 0.33.0 (link-foundation/start#162), which this repo
 * filed from the incident in issue #2189. This script runs them end to end so
 * the parsers are checked against actual output rather than a fixture:
 *
 *   1. launch a detached `screen`-isolated command through `$`,
 *   2. wait for it to finish,
 *   3. `$ --resume <uuid> -- <new command>` and check the wrapper's result,
 *   4. `$ --resume-all` and check the reconciliation summary.
 *
 * Usage:
 *   node experiments/issue-2189-start-command-resume.mjs [--bin /path/to/$]
 *
 * With an older `$` on PATH the wrappers must report `unsupported: true`
 * instead of throwing — that path is asserted too.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resumeAllIsolationSessions, resumeIsolatedSession } from '../src/isolation-runner.resume.lib.mjs';

const binIndex = process.argv.indexOf('--bin');
const bin = binIndex !== -1 ? process.argv[binIndex + 1] : null;
if (bin) {
  if (!existsSync(bin)) {
    console.error(`No such binary: ${bin}`);
    process.exit(1);
  }
  // The wrappers resolve `$` through PATH, exactly as the bot does.
  process.env.PATH = `${bin.replace(/\/[^/]+$/, '')}:${process.env.PATH}`;
}

const run = (...args) => spawnSync('$', args, { encoding: 'utf8', env: process.env });

const version = run('--version').stdout?.match(/version:\s*(\S+)/)?.[1] || '(unknown)';
console.log(`$ version: ${version}`);

const session = `hive-mind-issue-2189-${Date.now()}`;
const launch = run('--isolated', 'screen', '--detached', '--session', session, '--', 'echo resume-experiment-first-run');
console.log(`launch exit=${launch.status}`);
console.log(launch.stdout?.trim() || launch.stderr?.trim());
const uuid = (launch.stdout || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || session;
console.log(`execution identifier: ${uuid}`);

// Give the detached command time to exit before resuming it.
await new Promise(resolve => setTimeout(resolve, 3000));
console.log('\n--- $ --status ---');
console.log(run('--status', uuid, '--output-format', 'json').stdout?.trim());

console.log('\n--- resumeIsolatedSession(uuid, { command }) ---');
console.log(JSON.stringify(await resumeIsolatedSession(uuid, { command: 'echo resume-experiment-second-run', verbose: true }), null, 2));

console.log('\n--- resumeAllIsolationSessions() ---');
const all = await resumeAllIsolationSessions({ verbose: true });
console.log(JSON.stringify({ success: all.success, unsupported: all.unsupported, error: all.error, executions: all.executions.slice(0, 5) }, null, 2));

run('--stop', uuid);
