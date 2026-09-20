// Issue #2134: verify the new kill/recovery i18n keys resolve in every locale.
import { initI18n, preloadAllLocales, t } from '../src/i18n.lib.mjs';

await initI18n('en');
await preloadAllLocales();
const keys = ['telegram.session_recovered_oom', 'telegram.session_recovered_kill', 'telegram.session_recovered_at', 'telegram.session_recovered_resumed', 'telegram.session_kill_cause', 'telegram.session_kill_diagnostics'];
for (const locale of ['en', 'ru', 'zh', 'hi']) {
  for (const key of keys) {
    const value = t(key, { observedAt: '2026-08-02T17:40:30Z' }, { locale });
    const ok = value && value !== key;
    console.log(`${ok ? '✅' : '❌'} ${locale} ${key} => ${value}`);
    if (!ok) process.exitCode = 1;
  }
}
