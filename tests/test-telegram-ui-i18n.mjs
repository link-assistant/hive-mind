#!/usr/bin/env node

import assert from 'assert';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { buildSolveQueuedMessage, buildTelegramHelpMessage, buildTelegramInfoBlock } from '../src/telegram-ui-messages.lib.mjs';
import { formatExecutingWorkSessionMessage, formatSessionCompletionMessage, formatStartingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ❌ ${name}: ${error.message}`);
    failed++;
  }
}

function buildHelp(locale) {
  return buildTelegramHelpMessage({
    locale,
    chatId: 123,
    chatType: 'group',
    chatTitle: 'Test chat',
    solveEnabled: true,
    taskEnabled: true,
    hiveEnabled: true,
    showLimitsEnabled: true,
    isolationBackend: 'screen',
    modelDescription: 'Model description',
  });
}

console.log('🧪 Running Telegram UI i18n tests...\n');
await initI18n('en');
await preloadAllLocales();

await test('/help uses Russian UI strings when locale is ru', () => {
  const message = buildHelp('ru');
  assert.ok(message.includes('Справка SwarmMindBot'));
  assert.ok(message.includes('Решить задачу GitHub'));
  assert.ok(message.includes('Выполнить команду hive'));
  assert.ok(!message.includes('Available Commands'));
  assert.ok(!message.includes('Solve a GitHub issue'));
});

await test('/help has translated strings for every supported Telegram locale', () => {
  const expected = {
    en: 'SwarmMindBot Help',
    ru: 'Справка SwarmMindBot',
    zh: 'SwarmMindBot 帮助',
    hi: 'SwarmMindBot मदद',
  };
  for (const [locale, text] of Object.entries(expected)) {
    const message = buildHelp(locale);
    assert.ok(message.includes(text), `expected ${locale} help to include ${text}`);
    assert.ok(!message.includes('telegram.'), `expected ${locale} help to resolve all translation keys`);
  }
});

await test('/solve info and queue messages are locale-aware', () => {
  const infoBlock = buildTelegramInfoBlock({
    locale: 'ru',
    requester: '@user',
    urlKind: 'issue',
    url: 'https://github.com/o/r/issues/1',
    optionsRaw: '--model opus',
    lockedOptions: '--verbose',
  });
  assert.ok(infoBlock.includes('Запросил: @user'));
  assert.ok(infoBlock.includes('Задача: https://github.com/o/r/issues/1'));
  assert.ok(infoBlock.includes('🛠 Опции: --model opus'));
  assert.ok(infoBlock.includes('🔒 Заблокированные опции: --verbose'));
  assert.ok(!infoBlock.includes('Requested by'));

  const queued = buildSolveQueuedMessage({ locale: 'ru', tool: 'codex', position: 2, infoBlock, reason: 'CPU high' });
  assert.ok(queued.includes('Команда solve поставлена в очередь'));
  assert.ok(queued.includes('⏳ Ожидание: CPU high'));
  assert.ok(!queued.includes('Solve command queued'));
});

await test('work session status messages use the requested locale', () => {
  const infoBlock = buildTelegramInfoBlock({ locale: 'ru', requester: '@user', urlKind: 'url', url: 'https://github.com/o/r' });
  const starting = formatStartingWorkSessionMessage({ infoBlock, locale: 'ru' });
  const executing = formatExecutingWorkSessionMessage({ sessionName: 'session-1', isolationBackend: 'screen', infoBlock, locale: 'ru' });
  const completion = formatSessionCompletionMessage({
    locale: 'ru',
    sessionName: 'session-1',
    sessionInfo: { startTime: new Date('2026-05-10T00:00:00.000Z'), isolationBackend: 'screen' },
    statusResult: { exitCode: 0, startTime: '2026-05-10T00:00:00.000Z', endTime: '2026-05-10T00:01:05.000Z' },
    infoBlock,
  });

  assert.ok(starting.startsWith('🔄 Запуск...'));
  assert.ok(executing.startsWith('⏳ Выполняется...'));
  assert.ok(executing.includes('📊 Сеанс: `session-1`'));
  assert.ok(executing.includes('🔒 Изоляция: `screen`'));
  assert.ok(completion.startsWith('✅ *Рабочий сеанс успешно завершен*'));
  assert.ok(completion.includes('⏱️ Длительность: 1m 5s'));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
