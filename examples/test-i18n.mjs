#!/usr/bin/env node

/**
 * Example script for the Hive Mind i18n runtime.
 *
 * Run with:
 *   node examples/test-i18n.mjs
 */

import { getSupportedLocales, initI18n, normalizeLocale, preloadAllLocales, t } from '../src/i18n.lib.mjs';

console.log('Testing i18n functionality\n');

await initI18n('en');
await preloadAllLocales();

console.log('1. Available locales:', getSupportedLocales().join(', '));
console.log('2. Locale normalization:');
console.log('   - RU:', normalizeLocale('RU'));
console.log('   - zh-CN:', normalizeLocale('zh-CN'));
console.log('   - fr:', normalizeLocale('fr'), '\n');

console.log('3. Basic translations:');
for (const locale of getSupportedLocales()) {
  console.log(`   - ${locale}:`, t('error', {}, { locale }));
}

console.log('\n4. Parameter substitution:');
console.log('   -', t('error.url_type_not_supported', { type: 'gist' }));

console.log('\n5. Nested catalogue key:');
console.log('   -', t('telegram.solve_disabled'));

console.log('\n6. Multiline catalogue value:');
console.log(t('telegram.no_github_link_in_reply'));

console.log('\nDone.');
