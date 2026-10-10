/**
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/pull/2562#issuecomment-6035517822
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { initI18n, loadTranslations, t } from '../src/i18n.lib.mjs';
import { validateRuntimeModelName } from '../src/models/index.mjs';
import { validateGitHubUrl } from '../src/solve.validation.lib.mjs';
import { parseTaskIssueUrl } from '../src/task.split.lib.mjs';
import { formatTaskUrlError } from '../src/telegram-task-command.lib.mjs';

await initI18n('en');
const url = 'https://github.com/o/r/issuese/1';
const suggestion = 'https://github.com/o/r/issues/1';

for (const [locale, expected] of [
  ['en', `💡 Did you mean \`${suggestion}\`?`],
  ['ru', `💡 Вы имели в виду \`${suggestion}\`?`],
  ['zh', `💡 你是指 \`${suggestion}\`？`],
  ['hi', `💡 क्या आपका मतलब \`${suggestion}\` था?`],
]) {
  test(`Telegram URL suggestions are questions in ${locale}`, async () => {
    await loadTranslations(locale);
    assert.equal(t('telegram.did_you_mean', { suggestion }, { locale }), expected);
  });
}

test('task URL suggestions use question punctuation in CLI and Telegram replies', () => {
  const parsed = parseTaskIssueUrl(url);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.error.split('\n').at(-1), `Did you mean ${suggestion}?`);
  assert.equal(formatTaskUrlError(parsed, url).split('\n').at(-1), `💡 Did you mean \`${suggestion}\`?`);
});

for (const input of [url, 'https://githb.com/o/r/issues/1']) {
  test(`solve URL suggestions are questions for ${input}`, t => {
    const messages = [];
    t.mock.method(console, 'error', message => messages.push(message));
    assert.equal(validateGitHubUrl(input).isValid, false);
    assert.ok(messages.includes(`\n💡 Did you mean ${suggestion}?`), messages.join('\n'));
  });

  test(`hive URL suggestions are questions for ${input}`, { timeout: 30000 }, () => {
    const result = spawnSync(process.execPath, ['src/hive.mjs', input, '--dry-run'], { encoding: 'utf8', timeout: 25000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    const line = result.stderr.split('\n').find(line => line.startsWith('💡 Did you mean'));
    assert.equal(line, `💡 Did you mean ${suggestion}?`, result.stderr);
  });
}

test('model typo suggestions use a question without a colon', async () => {
  const result = await validateRuntimeModelName('gpt-6-slo', 'codex', { availableModels: ['gpt-6-sol', 'gpt-6-luna'] });
  assert.equal(result.valid, false);
  const question = result.message.split('\n').find(line => line.includes('Did you mean'));
  assert.match(question, /^\s+Did you mean "gpt-6-sol".*\?$/);
});
