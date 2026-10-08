// Issue #2809: check the new OOM kill count locale key in every locale.
import { initI18n, loadTranslations } from '../src/i18n.lib.mjs';
import { formatOomKillCount, formatKillRecoverySection } from '../src/session-kill-diagnostics.lib.mjs';
await initI18n?.();
for (const locale of ['en', 'ru', 'zh', 'hi']) await loadTranslations(locale);
for (const locale of [null, 'en', 'ru', 'zh', 'hi']) {
  console.log(locale, JSON.stringify(formatOomKillCount(9, locale)), JSON.stringify(formatOomKillCount(1, locale)));
}
console.log(formatKillRecoverySection({ observedAt: '2026-10-08T11:13:13.140Z', count: 9, locale: 'en' }));
