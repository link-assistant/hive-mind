/**
 * Renders the /limits Telegram section for a few realistic bot states, so the
 * display in issue #2070 can be inspected without a live bot.
 */
import { TelegramRateLimitTracker } from '../src/telegram-rate-limit.lib.mjs';
import { formatTelegramLimitsSection } from '../src/telegram-limits-section.lib.mjs';
import { preloadAllLocales } from '../src/i18n.lib.mjs';

await preloadAllLocales();

function show(title, build, locale = null) {
  let now = 1_000_000;
  const tracker = new TelegramRateLimitTracker({ now: () => now });
  const clock = { advance: ms => (now += ms) };
  build(tracker, clock);
  const snapshot = tracker.getSnapshot();
  console.log(`--- ${title}${locale ? ` [${locale}]` : ''}`);
  console.log(formatTelegramLimitsSection(snapshot, { locale }) || '(no section)');
  return snapshot;
}

const ok = (tracker, method, payload) => tracker.recordSuccess(tracker.recordRequest(method, payload));

// The /limits command itself: one sendMessage, then one editMessageText.
show('idle bot answering /limits in a group', tracker => {
  ok(tracker, 'getUpdates', {});
  ok(tracker, 'sendMessage', { chat_id: -100123 });
  ok(tracker, 'editMessageText', { chat_id: -100123 });
});

show('busy group approaching the 20/min window', tracker => {
  for (let i = 0; i < 13; i++) ok(tracker, 'sendMessage', { chat_id: -100123 });
});

show('flood control active', (tracker, clock) => {
  for (let i = 0; i < 18; i++) ok(tracker, 'sendMessage', { chat_id: -100123 });
  const pending = tracker.recordRequest('sendMessage', { chat_id: -100123 });
  tracker.recordError({ response: { error_code: 429, description: 'Too Many Requests: retry after 8', parameters: { retry_after: 8 } } }, pending);
  clock.advance(1_000);
});

show('after the retry_after expired, with the learned limit', (tracker, clock) => {
  for (let i = 0; i < 18; i++) ok(tracker, 'sendMessage', { chat_id: -100123 });
  const pending = tracker.recordRequest('sendMessage', { chat_id: -100123 });
  tracker.recordError({ response: { error_code: 429, parameters: { retry_after: 8 } } }, pending);
  clock.advance(9_000);
  ok(tracker, 'sendMessage', { chat_id: -100123 });
});

show('long flood control (hours)', (tracker, clock) => {
  for (let i = 0; i < 18; i++) ok(tracker, 'sendMessage', { chat_id: -100123 });
  const pending = tracker.recordRequest('sendMessage', { chat_id: -100123 });
  tracker.recordError({ response: { error_code: 429, parameters: { retry_after: 2282 } } }, pending);
  clock.advance(1_000);
});

for (const locale of ['ru', 'zh', 'hi']) {
  show(
    'busy group',
    tracker => {
      for (let i = 0; i < 13; i++) ok(tracker, 'sendMessage', { chat_id: -100123 });
    },
    locale
  );
}
