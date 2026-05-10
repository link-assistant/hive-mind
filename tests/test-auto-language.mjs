#!/usr/bin/env node

import assert from 'assert';
import { applyAutoLanguageToArgv, detectIssueLanguageFromText, extractLanguageWords } from '../src/auto-language.lib.mjs';
import { parseArguments } from '../src/solve.config.lib.mjs';

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

async function parseSolveArgs(args) {
  const originalArgv = process.argv;
  try {
    process.argv = ['node', 'solve.mjs', ...args];
    return await parseArguments();
  } finally {
    process.argv = originalArgv;
  }
}

console.log('🧪 Running auto-language tests...\n');

await test('extractLanguageWords tokenizes Latin and Cyrillic words', () => {
  assert.deepStrictEqual(extractLanguageWords('Fix баг in /limits 123'), ['Fix', 'баг', 'in', 'limits']);
});

await test('detectIssueLanguageFromText selects Russian above 51 percent of all words', () => {
  const result = detectIssueLanguageFromText('Ошибка лимиты очередь интерфейс fix');
  assert.strictEqual(result.language, 'ru');
  assert.ok(result.ratios.ru > 0.51, `expected ru ratio above threshold, got ${result.ratios.ru}`);
});

await test('detectIssueLanguageFromText selects English above 51 percent of all words', () => {
  const result = detectIssueLanguageFromText('Fix limits queue interface ошибка');
  assert.strictEqual(result.language, 'en');
  assert.ok(result.ratios.en > 0.51, `expected en ratio above threshold, got ${result.ratios.en}`);
});

await test('detectIssueLanguageFromText falls back to English when no language has majority', () => {
  const result = detectIssueLanguageFromText('fix queue ошибка лимиты');
  assert.strictEqual(result.language, 'en');
});

await test('detectIssueLanguageFromText requires majority of all words', () => {
  const result = detectIssueLanguageFromText('ошибка 中文');
  assert.strictEqual(result.language, 'en');
  assert.strictEqual(result.counts.ru, 1);
  assert.strictEqual(result.counts.total, 2);
});

await test('applyAutoLanguageToArgv sets workLanguage from issue text', async () => {
  const argv = { autoLanguage: true };
  const githubLib = {
    async ghIssueView() {
      return { code: 0, data: { title: 'Ошибка лимитов', body: 'Очередь и интерфейс должны быть на русском языке.' } };
    },
  };
  const result = await applyAutoLanguageToArgv({ argv, githubLib, owner: 'o', repo: 'r', number: 1, isIssueUrl: true, isPrUrl: false });
  assert.strictEqual(argv.workLanguage, 'ru');
  assert.strictEqual(result.language, 'ru');
});

await test('applyAutoLanguageToArgv preserves explicit work language', async () => {
  const argv = { autoLanguage: true, workLanguage: 'hi', _workLanguageExplicit: true };
  let fetched = false;
  const githubLib = {
    async ghIssueView() {
      fetched = true;
      return { code: 0, data: { title: 'Ошибка', body: 'Текст' } };
    },
  };
  const result = await applyAutoLanguageToArgv({ argv, githubLib, owner: 'o', repo: 'r', number: 1, isIssueUrl: true, isPrUrl: false });
  assert.strictEqual(result, null);
  assert.strictEqual(fetched, false);
  assert.strictEqual(argv.workLanguage, 'hi');
});

await test('parseArguments accepts --auto-language', async () => {
  const argv = await parseSolveArgs(['https://github.com/link-assistant/hive-mind/issues/675', '--auto-language']);
  assert.strictEqual(argv.autoLanguage, true);
});

await test('parseArguments maps hidden --prompt-language to workLanguage', async () => {
  const argv = await parseSolveArgs(['https://github.com/link-assistant/hive-mind/issues/675', '--prompt-language', 'ru']);
  assert.strictEqual(argv.workLanguage, 'ru');
  assert.strictEqual(argv._workLanguageExplicit, true);
});

await test('parseArguments lets --work-language override --prompt-language', async () => {
  const argv = await parseSolveArgs(['https://github.com/link-assistant/hive-mind/issues/675', '--prompt-language', 'ru', '--work-language', 'en']);
  assert.strictEqual(argv.workLanguage, 'en');
  assert.strictEqual(argv._workLanguageExplicit, true);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
