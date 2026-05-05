#!/usr/bin/env node
// Tests for src/i18n.lib.mjs
// Run with: node tests/test-i18n.mjs

import assert from 'assert';
import { initI18n, t, getCurrentLocale, setLocale, detectLocale, normalizeLocale, getSupportedLocales, getUserLocale, setUserLocale, clearUserLocale, resolveLocaleFromTelegramCtx, preloadAllLocales } from '../src/i18n.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

console.log('🧪 Running i18n tests...\n');

// 1. Locale detection / normalization
console.log('1) Locale normalization');
await test('normalizeLocale handles raw codes', () => {
  assert.strictEqual(normalizeLocale('en'), 'en');
  assert.strictEqual(normalizeLocale('RU'), 'ru');
  assert.strictEqual(normalizeLocale('zh-CN'), 'zh');
  assert.strictEqual(normalizeLocale('hi_IN'), 'hi');
  assert.strictEqual(normalizeLocale('en_US.UTF-8'), 'en');
  assert.strictEqual(normalizeLocale('fr'), null);
  assert.strictEqual(normalizeLocale(''), null);
  assert.strictEqual(normalizeLocale(null), null);
});

await test('detectLocale returns supported locale or default', () => {
  const orig = process.env.LANG;
  process.env.LANG = 'ru_RU.UTF-8';
  assert.strictEqual(detectLocale(), 'ru');
  process.env.LANG = 'fr_FR';
  assert.strictEqual(detectLocale(), 'en');
  process.env.LANG = orig || '';
});

await test('getSupportedLocales returns all four', () => {
  const list = getSupportedLocales();
  assert.deepStrictEqual(list.sort(), ['en', 'hi', 'ru', 'zh']);
});

// 2. Translations
console.log('\n2) Translations');
await test('English translations load and t() returns them', async () => {
  await initI18n('en');
  assert.strictEqual(getCurrentLocale(), 'en');
  assert.strictEqual(t('error'), 'Error');
  assert.strictEqual(t('success.process_completed'), 'Process completed');
});

await test('Russian translations work', async () => {
  await initI18n('ru');
  assert.strictEqual(getCurrentLocale(), 'ru');
  assert.strictEqual(t('error'), 'Ошибка');
});

await test('Chinese translations work', async () => {
  await initI18n('zh');
  assert.strictEqual(t('error'), '错误');
});

await test('Hindi translations work', async () => {
  await initI18n('hi');
  assert.strictEqual(t('error'), 'त्रुटि');
});

await test('Parameter substitution works', async () => {
  await initI18n('en');
  assert.strictEqual(t('error.url_type_not_supported', { type: 'foo' }), "URL type 'foo' is not supported");
});

await test('Missing key returns the key itself', async () => {
  await initI18n('ru');
  assert.strictEqual(t('this.key.does.not.exist'), 'this.key.does.not.exist');
});

await test('Newline escapes are decoded', async () => {
  await initI18n('en');
  const msg = t('telegram.no_github_link_in_reply');
  assert.ok(msg.includes('\n'), 'expected literal newlines in translation');
  assert.ok(!msg.includes('\\n'), 'expected backslash-n to be unescaped');
});

await test('Per-call locale override', async () => {
  await initI18n('en');
  assert.strictEqual(t('error', {}, { locale: 'ru' }), 'Ошибка');
  assert.strictEqual(t('error', {}, { locale: 'zh' }), '错误');
});

// 3. Telegram per-user locale
console.log('\n3) Per-user (Telegram) locale store');
await test('setUserLocale + getUserLocale', () => {
  setUserLocale(123, 'ru');
  assert.strictEqual(getUserLocale(123), 'ru');
  setUserLocale(123, 'zh-CN'); // normalised
  assert.strictEqual(getUserLocale(123), 'zh');
});

await test('setUserLocale rejects invalid', () => {
  const ok = setUserLocale(456, 'fr');
  assert.strictEqual(ok, false);
  assert.strictEqual(getUserLocale(456), null);
});

await test('clearUserLocale removes the entry', () => {
  setUserLocale(789, 'hi');
  assert.strictEqual(getUserLocale(789), 'hi');
  clearUserLocale(789);
  assert.strictEqual(getUserLocale(789), null);
});

await test('resolveLocaleFromTelegramCtx priority order', async () => {
  await initI18n('en');
  // Plain ctx → uses ctx.from.language_code
  const ctx1 = { from: { id: 1, language_code: 'ru' } };
  assert.strictEqual(resolveLocaleFromTelegramCtx(ctx1), 'ru');
  // Per-user override beats Telegram
  setUserLocale(1, 'zh');
  assert.strictEqual(resolveLocaleFromTelegramCtx(ctx1), 'zh');
  clearUserLocale(1);
  // Unsupported language_code falls through to current default
  setLocale('en');
  const ctx2 = { from: { id: 2, language_code: 'fr' } };
  assert.strictEqual(resolveLocaleFromTelegramCtx(ctx2), 'en');
});

// 4. Preload
console.log('\n4) Preload');
await test('preloadAllLocales does not throw', async () => {
  await preloadAllLocales();
  // After preload all locales are accessible via per-call override
  assert.strictEqual(t('error', {}, { locale: 'hi' }), 'त्रुटि');
});

// 5. CLI --language integration
console.log('\n5) CLI --language integration');
await test('task.mjs parser accepts --language ru', async () => {
  const { parseTaskArguments } = await import('../src/task.config.lib.mjs');
  const argv = parseTaskArguments(['node', 'task.mjs', 'do something', '--language', 'ru']);
  assert.strictEqual(argv.language, 'ru');
});

await test('task.mjs parser rejects unsupported language', async () => {
  const { parseTaskArguments } = await import('../src/task.config.lib.mjs');
  // yargs prints to stderr/stdout on validation; suppress for test cleanliness
  const origStderrWrite = process.stderr.write;
  const origStdoutWrite = process.stdout.write;
  process.stderr.write = () => true;
  process.stdout.write = () => true;
  try {
    let threw = false;
    try {
      parseTaskArguments(['node', 'task.mjs', 'do something', '--language', 'fr']);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, 'expected unsupported language to be rejected');
  } finally {
    process.stderr.write = origStderrWrite;
    process.stdout.write = origStdoutWrite;
  }
});

await test('hive auto-registers language via passthrough', async () => {
  const { getSolvePassthroughOptionNames } = await import('../src/hive.config.lib.mjs');
  const names = getSolvePassthroughOptionNames();
  assert.ok(names.includes('language'), 'expected language in hive passthrough list');
});

await test('SOLVE_OPTION_DEFINITIONS exposes language option', async () => {
  const { SOLVE_OPTION_DEFINITIONS } = await import('../src/solve.config.lib.mjs');
  assert.ok(SOLVE_OPTION_DEFINITIONS.language, 'expected language in SOLVE_OPTION_DEFINITIONS');
  assert.deepStrictEqual(SOLVE_OPTION_DEFINITIONS.language.choices, ['en', 'ru', 'zh', 'hi']);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
