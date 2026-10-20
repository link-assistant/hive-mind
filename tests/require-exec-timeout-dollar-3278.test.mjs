#!/usr/bin/env node
/**
 * RuleTester tests for hive/require-exec-timeout on command-stream `$` calls:
 * `$\`git …\`` and `$({ … })\`gh …\`` need an AbortSignal (`signal`), since
 * command-stream has no `timeout` option.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3278
 */

import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import requireExecTimeout from '../eslint-rules/require-exec-timeout.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const filename = join(process.cwd(), 'src/example.lib.mjs');
const violation = { messageId: 'violation' };
const dollarTimeout = { messageId: 'dollarTimeoutOption' };

ruleTester.run('require-exec-timeout ($)', requireExecTimeout, {
  valid: [
    { code: 'await $({ signal: AbortSignal.timeout(30_000) })`gh api user`;', filename },
    { code: 'await $({ mirror: false, signal: controller.signal })`git -C ${dir} fetch origin`;', filename },
    // Other commands are not checked.
    { code: 'await $`ls -la ${dir}`;', filename },
    { code: 'await $({ cwd })`npm test`;', filename },
    // A command built at runtime cannot be read.
    { code: 'await $`${command}`;', filename },
    // Options the rule cannot see are accepted.
    { code: 'await $(options)`gh pr view 1`;', filename },
    { code: 'await $({ ...defaults })`git status`;', filename },
    // Other tags are not command-stream.
    { code: 'const text = html`git ${ref}`;', filename },
    // Reasoned exceptions.
    { code: 'await $`git push origin ${branch}`; // hive-exec-timeout-ok: push of a large branch may take long', filename },
    { code: '// hive-exec-timeout-ok: lasts as long as the container\nawait $`docker wait ${id}`;', filename },
    // A `$` wrapper declared with the marker covers its calls.
    {
      code: ['// hive-exec-timeout-ok: the wrapper adds a default AbortSignal', 'const $ = withDefaultSignal(rawDollar);', 'await $`gh pr view 1`;'].join('\n'),
      filename,
    },
    // A `$` under another name that carries a signal.
    { code: 'const bounded = $({ signal: AbortSignal.timeout(1_000) });\nawait bounded`gh api user`;', filename },
    { code: 'const $silent = $({ mirror: false });\nawait $silent({ signal: AbortSignal.timeout(1_000) })`gh api user`;', filename },
    { code: ['// hive-exec-timeout-ok: lasts as long as the solve session', 'const probe = quietProbe($);', 'await probe`git fetch`;'].join('\n'), filename },
    // A local that is not bound to `$` is not command-stream.
    { code: 'const render = makeTemplate();\nrender`git ${ref}`;', filename },
    { code: 'const probe = quietProbe(other);\nawait probe`git status`;', filename },
    { code: "const { $: raw } = await use('command-stream');\nawait raw({ signal: AbortSignal.timeout(1_000) })`gh api user`;", filename },
    { code: 'const { tag: raw } = templates;\nawait raw`git status`;', filename },
    // Within the baseline.
    { code: 'await $`git status`;', filename, options: [{ baseline: { 'src/example.lib.mjs': { count: 1, reason: 'solve-process only' } } }] },
  ],
  invalid: [
    { code: 'await $`git status`;', filename, errors: [violation] },
    { code: 'await $`gh api repos/${owner}/${repo}`;', filename, errors: [violation] },
    { code: 'await $`docker pull ${image}`;', filename, errors: [violation] },
    { code: 'await $`/usr/bin/git fetch`;', filename, errors: [violation] },
    { code: 'await $({ cwd: dir })`git -C ${dir} log -1`;', filename, errors: [violation] },
    { code: 'await $({ mirror: false, capture: true })`gh pr view ${n} --json body`;', filename, errors: [violation] },
    // command-stream ignores `timeout`; only `signal` bounds the process.
    { code: 'await $({ timeout: 5000 })`gh api user`;', filename, errors: [dollarTimeout] },
    // A `$` wrapper without the marker is not trusted.
    { code: ['const $ = wrapDollarWithGhRetry(rawDollar);', 'await $`gh pr view 1`;'].join('\n'), filename, errors: [violation] },
    // A `$` under another name is followed: quietProbe($) binds no signal.
    { code: 'const probe = quietProbe($);\nawait probe`gh api user`;', filename, errors: [violation] },
    { code: 'await quietProbe($)`gh api user`;', filename, errors: [violation] },
    { code: 'const git = $({ cwd: tempDir });\nawait git`git status`;', filename, errors: [violation] },
    // Issue #3552: command-stream's `$` imported under another name, e.g. the unwrapped executor beside a retrying `$`.
    { code: "const { $: rawDollar$ } = await use('command-stream');\nawait rawDollar$`gh api repos/${owner}/${repo}`;", filename, errors: [violation] },
    { code: "const { $: raw } = await use('command-stream');\nawait raw({ mirror: false })`git fetch origin`;", filename, errors: [violation] },
    { code: 'const $silent = $({ mirror: false });\nawait $silent`git -C ${dir} log -1`;', filename, errors: [violation] },
    { code: 'const a = $;\nconst b = a;\nawait b`docker pull ${image}`;', filename, errors: [violation] },
    // A marker without a reason does not count.
    { code: 'await $`git push`; // hive-exec-timeout-ok:', filename, errors: [violation] },
    // Over the baseline: every call is listed.
    {
      code: 'await $`git status`;\nawait $`gh api user`;',
      filename,
      options: [{ baseline: { 'src/example.lib.mjs': { count: 1, reason: 'solve-process only' } } }],
      errors: [
        { messageId: 'overBaseline', line: 1 },
        { messageId: 'overBaseline', line: 2 },
      ],
    },
  ],
});
