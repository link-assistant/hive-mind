#!/usr/bin/env node
/**
 * RuleTester tests for the issue #3614 lint rules on bot-process modules:
 *   - hive/no-login-shell-probe: status probes (docker, pgrep, which, `$`…)
 *     must not go through command-stream's `/bin/sh -l -c` wrapper;
 *   - hive/no-overlapping-interval: no `setInterval`, whose async ticks pile
 *     up on a slow daemon; poll with startSerialPoller instead.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 */

import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import noLoginShellProbe from '../eslint-rules/no-login-shell-probe.mjs';
import noOverlappingInterval from '../eslint-rules/no-overlapping-interval.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const filename = join(process.cwd(), 'src/example.lib.mjs');
const baseline = { 'src/example.lib.mjs': { count: 1, reason: 'one-time action' } };

ruleTester.run('no-login-shell-probe', noLoginShellProbe, {
  valid: [
    { code: "await runProbe('docker', ['ps', '--format', '{{.Names}}']);", filename },
    // Commands that are not status probes are left to the other rules.
    { code: 'await $`git status --porcelain`;', filename },
    { code: 'await $({ mirror: false })`gh pr view ${pr} --json state`;', filename },
    // Other tagged templates are not command-stream.
    { code: 'const query = sql`docker ${name}`;', filename },
    { code: 'await $`which bun`; // hive-shell-ok: one-time runtime switch, needs the login PATH', filename },
    { code: ['// hive-shell-ok: fallback when $ is only on the login PATH', 'await $({ mirror: false })`${binPath} --status ${id}`;'].join('\n'), filename },
    { code: 'await $`docker kill ${name}`;', filename, options: [{ baseline }] },
  ],
  invalid: [
    { code: 'await $`docker inspect -f ${format} ${name}`;', filename, errors: [{ messageId: 'violation', data: { command: 'docker' } }] },
    { code: "await $({ mirror: false, signal: AbortSignal.timeout(1000) })`pgrep -l -x ${'claude'}`;", filename, errors: [{ messageId: 'violation', data: { command: 'pgrep' } }] },
    { code: 'const result = await $({ mirror: false })`which $`;', filename, errors: [{ messageId: 'violation', data: { command: 'which' } }] },
    { code: 'await $`screen -ls`;\nawait $`tmux has-session -t ${name}`;', filename, errors: [{ messageId: 'violation' }, { messageId: 'violation' }] },
    // start-command's `$ --status` through an interpolated binary path.
    { code: 'await $({ mirror: false })`${binPath} --status ${id} --output-format json`;', filename, errors: [{ messageId: 'violation', data: { command: '<interpolated binary>' } }] },
    // A local bound to `$(…)` is still command-stream.
    { code: 'const run = $({ mirror: false });\nawait run`docker ps`;', filename, errors: [{ messageId: 'violation' }] },
    { code: 'await $`docker ps`; // hive-shell-ok:', filename, errors: [{ messageId: 'violation' }] },
    {
      code: 'await $`docker kill ${a}`;\nawait $`docker rm -f ${a}`;',
      filename,
      options: [{ baseline }],
      errors: [
        { messageId: 'overBaseline', line: 1 },
        { messageId: 'overBaseline', line: 2 },
      ],
    },
  ],
});

ruleTester.run('no-overlapping-interval', noOverlappingInterval, {
  valid: [
    { code: 'startSerialPoller(tick, { intervalMs: 30000 });', filename },
    { code: 'const timer = setTimeout(run, 1000);', filename },
    // A local binding named setInterval is not the global.
    { code: 'function start({ setInterval }) { setInterval(tick, 10); }', filename },
    { code: 'const timer = setInterval(() => log.heartbeat(), 60000); // hive-interval-ok: synchronous tick', filename },
    { code: 'function start({ setIntervalImpl = setInterval } = {}) { return setIntervalImpl; }', filename, options: [{ baseline }] },
  ],
  invalid: [
    { code: 'setInterval(async () => { await monitorSessions(bot); }, 30000);', filename, errors: [{ messageId: 'violation' }] },
    { code: 'export function start({ setIntervalImpl = setInterval } = {}) { return setIntervalImpl(tick, 5); }', filename, errors: [{ messageId: 'violation' }] },
    { code: 'globalThis.x = 1;\nsetInterval(tick, 1); // hive-interval-ok:', filename, errors: [{ messageId: 'violation', line: 2 }] },
    {
      code: 'setInterval(a, 1);\nsetInterval(b, 1);',
      filename,
      options: [{ baseline }],
      errors: [
        { messageId: 'overBaseline', line: 1 },
        { messageId: 'overBaseline', line: 2 },
      ],
    },
  ],
});
