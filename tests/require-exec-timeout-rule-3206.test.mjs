#!/usr/bin/env node
/**
 * RuleTester tests for hive/require-exec-timeout: docker/git/gh child
 * processes need a `timeout` (or `signal`), unless marked or baselined.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3206
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

ruleTester.run('require-exec-timeout', requireExecTimeout, {
  valid: [
    { code: "await execAsync('docker pull image', { timeout: 600_000 });", filename },
    { code: "await execFileAsync('gh', ['api', 'user'], { timeout: 60_000 });", filename },
    { code: "spawn('docker', ['run', image], { stdio: 'pipe', signal: controller.signal });", filename },
    { code: "execSync('git fetch origin', { encoding: 'utf8', timeout: 60_000 });", filename },
    { code: 'child_process.execSync(`git -C ${dir} status`, { timeout: 5000 });', filename },
    // exec(command, options, callback)
    { code: "exec('gh api rate_limit', { timeout: 60_000 }, (error, stdout) => {});", filename },
    // Other commands are not checked.
    { code: "execSync('ls -la');", filename },
    { code: "spawn('node', ['script.mjs']);", filename },
    // Options the rule cannot see are accepted.
    { code: "execSync('git status', options);", filename },
    { code: "execFile('gh', args, { ...defaults });", filename },
    // A command built at runtime cannot be read.
    { code: 'execSync(command);', filename },
    // Reasoned exceptions.
    { code: "spawn('docker', ['wait', id]); // hive-exec-timeout-ok: lasts as long as the container", filename },
    { code: "// hive-exec-timeout-ok: stop() kills it\nspawn('docker', ['wait', id]);", filename },
    // A local wrapper declared with the marker covers its calls.
    {
      code: ['// hive-exec-timeout-ok: every call gets a default timeout', 'const exec = (cmd, opts) => execRaw(cmd, { timeout: 1000, ...opts });', "await exec('gh pr view 1');"].join('\n'),
      filename,
    },
    {
      code: ['// hive-exec-timeout-ok: every call gets a default timeout', 'function execAsync(cmd, opts) { return run(cmd, { timeout: 1000, ...opts }); }', "await execAsync('git push');"].join('\n'),
      filename,
    },
    // Within the baseline.
    { code: "execSync('git status');", filename, options: [{ baseline: { 'src/example.lib.mjs': 1 } }] },
  ],
  invalid: [
    { code: "execSync('git status');", filename, errors: [violation] },
    { code: "await execAsync('docker pull image');", filename, errors: [violation] },
    { code: "await execAsync('docker pull image', { maxBuffer: 1024 });", filename, errors: [violation] },
    { code: 'await exec(`gh api repos/${owner}/${repo}`);', filename, errors: [violation] },
    { code: "await execFileAsync('gh', ['api', 'user']);", filename, errors: [violation] },
    { code: "await execFileAsync('/usr/bin/git', ['fetch'], { cwd });", filename, errors: [violation] },
    { code: "spawn('docker', ['run', image], { stdio: 'pipe' });", filename, errors: [violation] },
    { code: "child_process.spawnSync('git', ['clone', url]);", filename, errors: [violation] },
    // exec(command, callback): the callback is not options.
    { code: "exec('gh auth status', (error, stdout) => {});", filename, errors: [violation] },
    // A wrapper without the marker is not trusted.
    {
      code: ['const exec = (cmd, opts) => execRaw(cmd, opts);', "await exec('gh pr view 1');"].join('\n'),
      filename,
      errors: [violation],
    },
    // A marker without a reason does not count.
    { code: "spawn('docker', ['wait', id]); // hive-exec-timeout-ok:", filename, errors: [violation] },
    // Over the baseline: every call is listed.
    {
      code: "execSync('git status');\nexecSync('git fetch');",
      filename,
      options: [{ baseline: { 'src/example.lib.mjs': 1 } }],
      errors: [
        { messageId: 'overBaseline', line: 1 },
        { messageId: 'overBaseline', line: 2 },
      ],
    },
  ],
});
