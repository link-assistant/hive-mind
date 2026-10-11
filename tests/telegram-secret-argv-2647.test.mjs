/**
 * @hive-mind-test-suite default
 * OS-level regression for issue #2647. Only fabricated credentials are used.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { containsInlineSecret, extractTelegramInlineOptions, secureTelegramArgv } from '../src/telegram-startup-config.lib.mjs';

const bot = fileURLToPath(new URL('../src/telegram-bot.mjs', import.meta.url));
const probe = fileURLToPath(new URL('../experiments/issue-2647/argv-probe.mjs', import.meta.url));
const token = 'fake-telegram-credential-2647';
const configuration = `TELEGRAM_BOT_TOKEN: '${token}'\nTELEGRAM_ALLOWED_CHATS: 123456789`;

function inspectStartup(args, env = process.env, expectedCode = 0, signal = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--stack-size=768', '--import', probe, bot, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stdout.on('data', data => {
      stdout += data;
      if (signal && stdout.includes('\n')) child.kill(signal);
    });
    child.stderr.on('data', data => (stderr += data));
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        assert.equal(code, expectedCode, stderr);
        resolve({ snapshot: JSON.parse(stdout.trim()), stderr, originalPid: child.pid });
      } catch (error) {
        reject(error);
      }
    });
  });
}

test('inline LINO is removed from the bot OS command line before dependencies load', { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
  const { snapshot, originalPid } = await inspectStartup(['--configuration', configuration, '--dry-run']);
  assert.equal(snapshot.pid, originalPid, 'replace the original process without leaving a secret-bearing supervisor');
  assert.ok(!snapshot.cmdline.includes(token), 'the Telegram credential must not remain in /proc/self/cmdline');
  assert.ok(!snapshot.cmdline.includes('TELEGRAM_ALLOWED_CHATS'), 'the entire inline configuration must be removed');
  assert.ok(!snapshot.argv.includes(configuration));
  assert.ok(snapshot.argv.includes('--dry-run'));
  assert.ok(snapshot.execArgv.includes('--import'));
  assert.ok(snapshot.execArgv.includes('--stack-size=768'));
  assert.equal(snapshot.transportPresent, false, 'consume the private transport before dependency loading');
});

for (const args of [['-c', configuration], [`--configuration=${configuration}`], [`-c=${configuration}`], [`-c${configuration}`], ['-vc', configuration], ['--token', token], ['-t', token], [`--token=${token}`], [`-t=${token}`], [`-t${token}`], ['-vt', token]]) {
  test(`removes inline secrets with ${args[0].split('=')[0].slice(0, 18)}`, { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
    const { snapshot, stderr, originalPid } = await inspectStartup([...args, '--dry-run']);
    assert.equal(snapshot.pid, originalPid);
    assert.ok(!snapshot.cmdline.includes(token));
    assert.ok(stderr.includes('visible to every user and process'));
    assert.ok(stderr.includes('.lenv') && stderr.includes('--configuration-file'), 'recommend .lenv or a Links Notation file');
    assert.ok(!stderr.includes(token));
    assert.equal(snapshot.transportPresent, false);
  });
}

test('file and environment startup keeps secrets off argv without replacement', { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
  const { snapshot, stderr } = await inspectStartup(['--configuration-file', '/private/bot.lenv', '--dry-run'], { ...process.env, TELEGRAM_BOT_TOKEN: token });
  assert.ok(!snapshot.cmdline.includes(token));
  assert.ok(snapshot.cmdline.includes('/private/bot.lenv'));
  assert.equal(stderr, '');
});

test('extracts repeated options with last value winning and respects the argument terminator', () => {
  assert.deepEqual(extractTelegramInlineOptions(['--verbose', '-c', 'first', '--configuration=last', '-t', token, '--', '--token', 'positional']), {
    args: ['--verbose', '--', '--token', 'positional'],
    options: { configuration: 'last', token },
  });
  // Flags without a value are left to the CLI parser instead of failing startup.
  assert.deepEqual(extractTelegramInlineOptions(['-c']), { args: ['-c'], options: {} });
  assert.deepEqual(extractTelegramInlineOptions(['--token', '--dry-run']), { args: ['--token', '--dry-run'], options: {} });
});

test('only credentials trigger the warning; non-secret inline configuration is used as is', () => {
  assert.equal(containsInlineSecret({ token }), true);
  assert.equal(containsInlineSecret({ configuration }), true);
  assert.equal(containsInlineSecret({ configuration: "GITHUB_API_KEY: 'x'" }), true);
  assert.equal(containsInlineSecret({ configuration: 'TELEGRAM_ALLOWED_CHATS: 123456789\nTELEGRAM_HIVE: false' }), false);
  const warnings = [];
  const execve = () => assert.fail('non-secret configuration must not re-launch the process');
  const options = secureTelegramArgv({ argv: ['node', bot, '-c', 'TELEGRAM_HIVE: false'], env: {}, execve, warn: message => warnings.push(message) });
  assert.deepEqual(options, { configuration: 'TELEGRAM_HIVE: false' });
  assert.deepEqual(warnings, []);
});

test('runtimes without process replacement warn but still accept inline secrets', () => {
  const warnings = [];
  const options = secureTelegramArgv({ argv: ['node', bot, '-t', token], env: {}, execve: null, warn: message => warnings.push(message) });
  assert.deepEqual(options, { token });
  assert.match(warnings.join('\n'), /\.lenv.*--configuration-file/s);
  assert.match(warnings.join('\n'), /cannot re-launch/);
  assert.ok(!warnings.join('\n').includes(token));
  assert.deepEqual(secureTelegramArgv({ argv: ['node', bot, '--configuration-file', 'bot.lenv'], env: {}, execve: null, warn: () => assert.fail('no warning without inline secrets') }), {});
});

test('replacement failure warns, continues, and never echoes secrets from runtime errors', () => {
  const warnings = [];
  const options = secureTelegramArgv({
    argv: ['node', bot, '-t', token],
    env: {},
    execve: () => {
      throw new Error(token);
    },
    warn: message => warnings.push(message),
  });
  assert.deepEqual(options, { token });
  assert.match(warnings.join('\n'), /re-launching without these arguments failed/);
  assert.ok(!warnings.join('\n').includes(token));
});

test('protected startup transport is consumed before dependencies or child commands', () => {
  const env = { HIVE_MIND_TELEGRAM_ARGV_OPTIONS: JSON.stringify({ token, configuration }) };
  assert.deepEqual(secureTelegramArgv({ argv: ['node', bot], env }), { token, configuration });
  assert.deepEqual(env, {});
  assert.throws(() => secureTelegramArgv({ argv: ['node', bot], env: { HIVE_MIND_TELEGRAM_ARGV_OPTIONS: 'invalid' } }), /Invalid protected/);
});

test('process replacement preserves nonzero exit status and shutdown signals', { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
  const exited = await inspectStartup(['--token', token], { ...process.env, HIVE_MIND_ARGV_PROBE_EXIT_CODE: '42' }, 42);
  assert.equal(exited.snapshot.pid, exited.originalPid);
  const signaled = await inspectStartup(['--token', token], { ...process.env, HIVE_MIND_ARGV_PROBE_HOLD: 'true' }, 23, 'SIGTERM');
  assert.equal(signaled.snapshot.pid, signaled.originalPid);
});

test('the bot still starts with an inline token when process replacement is unavailable', { timeout: 90000 }, async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TELEGRAM_') && key !== 'HIVE_MIND_CONFIGURATION_FILE'));
  const withoutExecve = 'data:text/javascript,delete process.execve';
  const { code, output } = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', withoutExecve, bot, '--token', token, '--dry-run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', data => (text += data));
    child.stderr.on('data', data => (text += data));
    child.on('error', reject);
    child.on('close', exitCode => {
      clearTimeout(timer);
      resolve({ code: exitCode, output: text });
    });
  });
  assert.equal(code, 0, output);
  assert.ok(output.includes('visible to every user and process'), output);
  assert.ok(output.includes('cannot re-launch'), output);
  assert.ok(output.includes('Dry-run mode'), output);
  assert.ok(!output.includes(token), output);
});
