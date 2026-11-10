/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTelegramConfiguration, moveTelegramSecretsOffArgv } from '../src/telegram-private-configuration.lib.mjs';
const secret = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');

test('inline Telegram configuration and token options leave OS argv after execve (#2647)', { timeout: 15000 }, () => {
  for (const args of [['--configuration', `TELEGRAM_BOT_TOKEN: ${secret}`], [`--configuration=TELEGRAM_BOT_TOKEN: ${secret}`], ['-c', `TELEGRAM_BOT_TOKEN: ${secret}`], ['--token', secret], [`--token=${secret}`], ['-t', secret], [`-t${secret}`], [`-cTELEGRAM_BOT_TOKEN: ${secret}`]]) {
    const child = spawnSync(process.execPath, ['experiments/issue-3739/private-argv-fixture.mjs', ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).privateArgv, true);
  }
  let called = false;
  assert.equal(
    moveTelegramSecretsOffArgv({
      argv: ['node', 'bot.mjs', '--configuration-file', '/tmp/private.lenv'],
      env: {},
      execve: () => {
        called = true;
      },
    }),
    false
  );
  assert.equal(called, false);
});

test('file and inline configuration populate all defaults; explicit token retains priority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'telegram-private-'));
  try {
    const file = join(root, 'bot.lenv');
    await writeFile(file, 'TELEGRAM_BOT_TOKEN: from-file\nTELEGRAM_ALLOWED_CHATS: 2345', { mode: 0o600 });
    for (const [inline, cli, expected] of [
      [undefined, undefined, 'from-file'],
      ['TELEGRAM_BOT_TOKEN: from-inline', undefined, 'from-inline'],
      ['TELEGRAM_BOT_TOKEN: from-inline', 'from-cli', 'from-cli'],
    ]) {
      const env = { TELEGRAM_BOT_TOKEN: 'from-env' };
      if (inline !== undefined) env.HIVE_MIND_TELEGRAM_CLI_CONFIGURATION = inline;
      if (cli !== undefined) env.HIVE_MIND_TELEGRAM_CLI_TOKEN = cli;
      const config = await loadTelegramConfiguration({
        env,
        parse: () => ({ configurationFile: file, configuration: env.TELEGRAM_CONFIGURATION, token: env.TELEGRAM_BOT_TOKEN, allowedChats: env.TELEGRAM_ALLOWED_CHATS }),
        loadConfiguration: async text => {
          for (const line of text.split('\n')) {
            const [name, ...value] = line.split(':');
            env[name] = value.join(':').trim();
          }
        },
      });
      assert.equal(config.token, expected);
      assert.equal(config.allowedChats, '2345');
      assert.equal(env.HIVE_MIND_TELEGRAM_CLI_TOKEN, undefined);
      assert.equal(env.HIVE_MIND_TELEGRAM_CLI_CONFIGURATION, undefined);
    }
    await assert.rejects(loadTelegramConfiguration({ env: {}, parse: () => ({ configurationFile: join(root, 'missing') }), loadConfiguration: async () => {} }), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('generated example and both embedded deployment-template sources use a placeholder (#3951)', async () => {
  for (const path of ['.lenv.example', 'docs/case-studies/issue-1879/raw/server-setup-gist.txt', 'docs/case-studies/issue-1901/data/raw/deploy-gist-67532e7a7090462a618ca86fc00d06a6.txt']) {
    const text = await readFile(path, 'utf8');
    if (path !== '.lenv.example') assert.ok(text.includes('LENV_EXAMPLE_TEMPLATE'));
    const values = [...text.matchAll(/^TELEGRAM_BOT_TOKEN:\s*([^\r\n]+)/gm)].map(match => match[1]);
    assert.ok(values.length > 0, path);
    assert.ok(
      values.every(value => value === 'YOUR_TELEGRAM_BOT_TOKEN'),
      `${path}: only explicit placeholders belong in examples`
    );
  }
});
