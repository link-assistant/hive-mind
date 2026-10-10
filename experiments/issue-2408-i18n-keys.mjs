#!/usr/bin/env node
// Checks that the issue #2408 Telegram keys resolve in every locale.
import { initI18n, preloadAllLocales, t } from '../src/i18n.lib.mjs';
await initI18n('en');
await preloadAllLocales();
for (const locale of ['en', 'ru', 'hi', 'zh']) {
  console.log(locale, '|', t('telegram.work_session_recovered', {}, { locale }), '|', t('telegram.work_session_recoveries', { count: 2 }, { locale }), '|', t('telegram.work_session_recovering', { exitCode: 1 }, { locale }));
}
