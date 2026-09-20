/**
 * Renders the /limits Telegram section into an HTML page styled like the
 * Telegram code block in the issue #2070 screenshot, so the case study can
 * show a real before/after without a live bot.
 *
 * Usage: node experiments/render-telegram-limits-screenshot.mjs > /tmp/telegram-limits.html
 */
import { TelegramRateLimitTracker } from '../src/telegram-rate-limit.lib.mjs';
import { formatTelegramLimitsSection } from '../src/telegram-limits-section.lib.mjs';
import { preloadAllLocales } from '../src/i18n.lib.mjs';

await preloadAllLocales();

function render(build) {
  let now = 1_000_000;
  const tracker = new TelegramRateLimitTracker({ now: () => now });
  const accept = (method, payload = {}) => tracker.recordSuccess(tracker.recordRequest(method, payload));
  const refuse = (method, payload, retryAfter) => tracker.recordError({ response: { error_code: 429, description: `Too Many Requests: retry after ${retryAfter}`, parameters: { retry_after: retryAfter } } }, tracker.recordRequest(method, payload));
  build({ accept, refuse, advance: ms => (now += ms) });
  return formatTelegramLimitsSection(tracker.getSnapshot(), {}).trimEnd();
}

const before = `Telegram Bot API (local rolling telemetry)
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% used
0/30 messages in 1s
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% used
0/20 messages in busiest group over 1m
429 responses since startup: 0`;

const idle = render(({ accept }) => {
  accept('getUpdates', {});
  accept('sendMessage', { chat_id: -100123 });
  accept('editMessageText', { chat_id: -100123 });
});

const busy = render(({ accept }) => {
  for (let i = 0; i < 13; i++) accept('sendMessage', { chat_id: -100123 });
});

const throttled = render(({ accept, refuse, advance }) => {
  for (let i = 0; i < 18; i++) accept('sendMessage', { chat_id: -100123 });
  refuse('sendMessage', { chat_id: -100123 }, 8);
  advance(1_000);
});

const blocks = [
  ['Before — the reported display', before],
  ['After — idle bot answering /limits in a group', idle],
  ['After — a group approaching its limit', busy],
  ['After — Telegram is actively refusing', throttled],
];

const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

console.log(`<!doctype html>
<meta charset="utf-8">
<style>
  body { background: #0e1621; color: #fff; font-family: system-ui, sans-serif; margin: 0; padding: 24px; width: 900px; }
  h2 { font-size: 15px; font-weight: 500; color: #7d8b99; margin: 20px 0 8px; }
  h2:first-child { margin-top: 0; }
  pre { background: #17212b; border-left: 3px solid #6ab3f3; border-radius: 6px; color: #fff;
        font-family: 'DejaVu Sans Mono', 'Menlo', monospace; font-size: 15px; line-height: 1.45;
        margin: 0; padding: 12px 16px; white-space: pre; }
</style>
${blocks.map(([title, body]) => `<h2>${escape(title)}</h2>\n<pre>${escape(body)}</pre>`).join('\n')}
`);
