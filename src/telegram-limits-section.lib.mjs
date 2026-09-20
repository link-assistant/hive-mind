/**
 * Renders the Telegram Bot API section of `/limits` (issue #2070).
 *
 * The section shows exactly one bar, for the window closest to refusing the next
 * request, because Telegram enforces several limits at once and only the tightest
 * one can stop the bot. See telegram-rate-limit.lib.mjs for how the windows are
 * measured and corrected.
 */

import { localizeCompactDuration, lt } from './limits-i18n.lib.mjs';
import { getProgressBar } from './progress-bar.lib.mjs';

const FULL_PERCENTAGE = 100;

/**
 * Format a `retry_after` countdown.
 * Telegram's values span three orders of magnitude — routine flood control returns
 * ~10s, while repeat offences have been observed returning 2282s and above — so
 * the countdown has to carry hours, not just seconds.
 * @see https://github.com/tdlib/telegram-bot-api/issues/184
 */
export function formatRetryDuration(seconds, options = {}) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const parts = [];
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);
  return localizeCompactDuration(parts.join(' '), options);
}

function formatThrottledLabel(lastRateLimit, options) {
  const label = lt('telegram_flood_control', {}, options);
  const seconds = lastRateLimit?.retryRemainingSeconds;
  if (!seconds) return label;
  return `${label}, ${lt('telegram_retry_in', { duration: formatRetryDuration(seconds, options) }, options)}`;
}

function formatUsageLine(display, options) {
  const requests = lt('telegram_requests', { used: display.used, limit: display.limit }, options);
  // Say so when the number came from Telegram refusing or accepting a call,
  // rather than from the documentation, since the two disagree in practice.
  const source = display.limitSource === 'observed' ? ` (${lt('telegram_observed_limit', {}, options)})` : '';
  return `${requests}${source}, ${lt('telegram_peak', { peak: display.peak }, options)}`;
}

/**
 * @param {object|null} telegramRateLimit - Snapshot from TelegramRateLimitTracker
 * @param {object} options - { locale }
 * @returns {string|null} Section text, or null when there is nothing measured yet
 */
export function formatTelegramLimitsSection(telegramRateLimit, options = {}) {
  const display = telegramRateLimit?.display;
  if (!display) return null;

  const locale = options?.locale || null;
  const lastRateLimit = telegramRateLimit.lastRateLimit || null;
  // While retry_after is still counting down, the rolling windows are the wrong
  // thing to report: Telegram has already said no, whatever they estimate. Show
  // the refusal, and let the bar fall back to measured usage once it expires.
  const throttled = Boolean(telegramRateLimit.throttled);
  const usedPercentage = throttled ? FULL_PERCENTAGE : display.usedPercentage;
  const label = throttled ? formatThrottledLabel(lastRateLimit, { locale }) : lt(`telegram_scope_${display.id}`, {}, { locale });
  const suffix = usedPercentage >= FULL_PERCENTAGE ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;

  let section = `${lt('telegram_api', {}, { locale })}\n`;
  section += `${getProgressBar(usedPercentage)} ${usedPercentage}%${suffix} (${label})\n`;
  section += `${formatUsageLine(display, { locale })}\n`;
  section += `${lt('telegram_rate_limit_responses', { count: telegramRateLimit.rateLimitResponses }, { locale })}\n`;
  if (lastRateLimit) section += `${lt('telegram_last_rate_limit', { method: lastRateLimit.method }, { locale })}\n`;
  return section;
}

export default { formatRetryDuration, formatTelegramLimitsSection };
