#!/usr/bin/env node
/**
 * Issue #3282: Claude Code receives the system prompt and the user prompt
 * verbatim.
 *
 * `claude.lib.mjs` escaped `"` and `$` itself and wrapped the result in "..."
 * inside command-stream's `$`, which already shell-quotes every value:
 *
 * - with command-stream 0.18.0 (docs/case-studies/issue-2169) the extra quotes
 *   made that quoting literal, so /bin/sh expanded the prompt: every run logged
 *   `/bin/sh: 1: .png: not found`, and the system prompt's `$(gh auth token)`
 *   example became the token itself;
 * - with 2.4.0, used to reproduce the issue, nothing is expanded,
 *   but Claude gets each `"` of the system prompt (and of a resumed session's
 *   prompt) as `\"`.
 *
 * The command `executeClaudeCommand` builds is replayed through the pinned
 * command-stream (the devDependency) against a fake `claude` that records its
 * argv; the command it logs (and returns with --dry-run) is replayed through
 * /bin/sh the same way.
 *
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { $ as realDollar } from 'command-stream';

process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '1';
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { USE_M_PACKAGE_VERSIONS } = await import('../src/use-with-retry.lib.mjs');
const { resetCumulativeAnthropicCost } = await import('../src/anthropic-cost-accumulator.lib.mjs');

const SESSION = '3282aaaa-0000-4000-8000-000000000000';
const STREAM = [
  { type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-opus-4-8' },
  { type: 'result', subtype: 'success', is_error: false, session_id: SESSION, result: 'Done.', num_turns: 1, total_cost_usd: 0 },
];

test('the tests replay the command-stream version production loads', () => {
  const { devDependencies } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(devDependencies['command-stream'], USE_M_PACKAGE_VERSIONS['command-stream']);
});

async function run(t, argv) {
  resetCumulativeAnthropicCost();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-prompt-argv-3282-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'executed');
  const argvFile = path.join(dir, 'argv.json');
  const fakeClaude = path.join(dir, 'claude');
  await writeFile(fakeClaude, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));\n`);
  await chmod(fakeClaude, 0o755);
  // Shell syntax of every kind, plus an apostrophe-only span command-stream would pass through as already quoted.
  const systemPrompt = `Use the 'file' command, retry with: curl -H "Authorization: token $(echo LEAKED-3282)" "<url>".\nFiles saved as \`touch ${marker}\` or \`.png\`; C:\\tmp\\ costs $5 & more | less > out ! ~`;
  const prompt = `Issue to solve: it's "quoted" $(echo LEAKED-3282) \`touch ${marker}\``;
  const logs = [];
  let template = null;
  const fakeDollar =
    options =>
    (strings, ...values) => {
      template = { options, strings, values };
      return {
        result: { code: 0 },
        kill() {},
        async *stream() {
          yield { type: 'stdout', data: Buffer.from(STREAM.map(event => JSON.stringify(event)).join('\n') + '\n') };
        },
      };
    };
  let logFile = path.join(dir, 'run.log');
  await writeFile(logFile, '');
  const result = await executeClaudeCommand({
    tempDir: dir,
    branchName: 'issue-3282-test',
    prompt,
    systemPrompt,
    argv: { model: 'opus', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/3282', verbose: false, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false, ...argv },
    log: async message => logs.push(String(message)),
    getLogFile: () => logFile,
    setLogFile: value => {
      logFile = value;
    },
    formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
    getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    claudePath: 'claude',
    $: fakeDollar,
    owner: 'link-assistant',
    repo: 'hive-mind',
    prNumber: 3390,
    issueNumber: 3282,
  });
  const received = async () => JSON.parse(await readFile(argvFile, 'utf8'));
  const flag = (args, name) => args[args.indexOf(name) + 1];
  return { result, logs, template, systemPrompt, prompt, marker, fakeClaude, received, flag, dir };
}

test('the spawned claude gets the system prompt verbatim, with nothing executed', { timeout: 30_000 }, async t => {
  const { result, template, systemPrompt, prompt, marker, fakeClaude, received, flag } = await run(t, {});
  assert.equal(result.success, true);
  assert.ok(template, 'claude was started');
  const values = [fakeClaude, ...template.values.slice(1)];
  const replay = await realDollar({ mirror: false, stdin: '' })(template.strings, ...values);
  assert.equal(String(replay.stderr), '', 'the shell ran nothing from the prompt');
  const args = await received();
  assert.equal(flag(args, '--append-system-prompt'), systemPrompt);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(template.options.stdin, prompt, 'the user prompt goes over stdin as it is');
});

test('a resumed session gets -p and the system prompt verbatim', { timeout: 30_000 }, async t => {
  const { template, systemPrompt, prompt, marker, fakeClaude, received, flag } = await run(t, { resume: SESSION });
  const values = [fakeClaude, ...template.values.slice(1)];
  const replay = await realDollar({ mirror: false, stdin: '' })(template.strings, ...values);
  assert.equal(String(replay.stderr), '');
  const args = await received();
  assert.equal(flag(args, '--resume'), SESSION);
  assert.equal(flag(args, '-p'), prompt);
  assert.equal(flag(args, '--append-system-prompt'), systemPrompt);
  assert.equal(fs.existsSync(marker), false);
});

test('the logged command (and --dry-run result) is copy-pastable shell', { timeout: 30_000 }, async t => {
  const { result, logs, systemPrompt, prompt, marker, fakeClaude, received, flag, dir } = await run(t, { dryRun: true });
  assert.equal(result.preparedOnly, true);
  assert.ok(logs.includes(result.preparedCommand), 'the same command is logged');
  // Run it with the fake claude first on PATH; `| jq -c .` is dropped so jq is not needed.
  const command = result.preparedCommand.replace(/ \| jq -c \.\)$/, ')');
  assert.notEqual(command, result.preparedCommand);
  execFileSync('/bin/sh', ['-c', command], { env: { ...process.env, PATH: `${path.dirname(fakeClaude)}:${process.env.PATH}` }, cwd: dir, timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const args = await received();
  assert.equal(flag(args, '-p'), prompt);
  assert.equal(flag(args, '--append-system-prompt'), systemPrompt);
  assert.equal(fs.existsSync(marker), false);
});
