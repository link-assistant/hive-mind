import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initI18n, t } from '../src/i18n.lib.mjs';
test('issue 4069 keys resolve in every locale', async () => {
  await initI18n('en');
  const keys = ['telegram.solve_after_queued', 'telegram.solve_after_waiting_success', 'telegram.solve_after_waiting_finish', 'telegram.solve_after_waiting_blockers', 'telegram.solve_after_released', 'telegram.solve_after_dependency_failed', 'telegram.solve_after_blockers_not_queued', 'telegram.solve_after_usage', 'telegram.solve_after_many_tasks', 'telegram.solve_after_invalid_link', 'telegram.solve_after_unknown_target', 'telegram.solve_after_no_task_link', 'telegram.solve_after_target_failed', 'telegram.solve_after_target_finished', 'telegram.help_solve_after', 'telegram.help_solve_respect_blockers', 'telegram.solve_queued', 'telegram.help_solve_reply'];
  for (const locale of ['en', 'ru', 'zh', 'hi'])
    for (const key of keys) {
      const value = t(key, { tasks: 'T', task: 'K', description: 'D', blockers: 'B', links: 'L', detail: 'X', tool: 'claude', position: 1 }, { locale });
      assert.notEqual(value, key, `${locale} ${key}`);
      assert.ok(!value.includes('{{'), `${locale} ${key}: ${value}`);
    }
  console.log(t('telegram.solve_after_usage', {}, { locale: 'en' }));
});
