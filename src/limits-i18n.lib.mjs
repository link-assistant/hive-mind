import { t } from './i18n.lib.mjs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

const ENGLISH_LIMITS = {
  additional_codex_limits: 'Additional Codex limits',
  balance: 'balance',
  claude_5_hour_session: 'Claude 5 hour session',
  claude_limits: 'Claude limits',
  codex_5_hour_session: 'Codex 5 hour session',
  codex_credits: 'Codex credits',
  codex_limits: 'Codex limits',
  cpu: 'CPU',
  cpu_cores_used: 'CPU cores used',
  current_time: 'Current time',
  current_week_all_models: 'Current week (all models)',
  current_week_sonnet_only: 'Current week (Sonnet only)',
  disabled_by_admin: '`--show-limits` is disabled by the bot administrator.',
  disk_space: 'Disk space',
  duration_day_short: 'd',
  duration_hour_short: 'h',
  duration_minute_short: 'm',
  duration_second_short: 's',
  end: 'End',
  five_hour_session: '5h session',
  five_min_load_avg: '5m load avg',
  github_api: 'GitHub API',
  limits_at_end: 'Limits at end',
  limits_at_start: 'Limits at start',
  limits_change: 'Limits change',
  na: 'N/A',
  note_delta_approx: 'Note: delta is approximate (parallel sessions share the same budget).',
  passed: 'passed',
  plan: 'Plan',
  ram: 'RAM',
  reason_claude_5_hour_session: 'Claude 5 hour session limit is {{currentPercent}}% (threshold: {{thresholdPercent}})',
  reason_claude_running: 'Claude process is already running',
  reason_claude_weekly: 'Claude weekly limit is {{currentPercent}}% (threshold: {{thresholdPercent}})',
  reason_codex_5_hour_session: 'Codex 5 hour session limit is {{currentPercent}}% (threshold: {{thresholdPercent}})',
  reason_codex_running: 'Codex process is already running',
  reason_codex_weekly: 'Codex weekly limit is {{currentPercent}}% (threshold: {{thresholdPercent}})',
  reason_cpu_usage: 'CPU usage is {{currentPercent}}% (threshold: {{thresholdPercent}})',
  reason_disk_usage: 'Disk usage is {{currentPercent}}% (threshold: {{thresholdPercent}})',
  reason_gemini_running: 'Gemini CLI process is already running',
  reason_github_api: 'GitHub API usage is {{currentPercent}}% (threshold: {{thresholdPercent}})',
  reason_min_interval: 'Minimum interval between commands not reached',
  reason_qwen_running: 'Qwen Code process is already running',
  reason_ram_usage: 'RAM usage is {{currentPercent}}% (threshold: {{thresholdPercent}})',
  reason_threshold_exceeded: '{{metric}} threshold exceeded',
  remaining: '{{duration}} remaining',
  requests: 'requests',
  resets_at: 'Resets {{time}}',
  resets_in: 'Resets in {{duration}}',
  resource_limit_exceeded: 'Resource limit exceeded',
  solve_queue_status: 'Solve Queue Status',
  queue_completed: 'Completed',
  queue_failed: 'Failed',
  queue_and_more: 'and {{count}} more',
  queue_pending: 'pending',
  queue_processing: 'processing',
  queue_processes: '{{count}} processes',
  queue_status_cancelled: 'cancelled',
  queue_status_failed: 'failed',
  queue_status_queued: 'queued',
  queue_status_started: 'started',
  queue_status_starting: 'starting',
  queue_status_waiting: 'waiting',
  queue_waiting_current_command: 'waiting for current command',
  queue_waiting_in_queue: 'Waiting in queue',
  queues: 'Queues',
  seven_day_all_models: '7d all models',
  seven_day_sonnet_only: '7d Sonnet only',
  session: 'session',
  start: 'Start',
  unavailable: 'unavailable',
  unlimited: 'unlimited',
  used: 'used',
  week: 'week',
  weekly: 'Weekly',
};

function applyParams(text, params = {}) {
  let out = text;
  for (const [key, value] of Object.entries(params)) {
    out = out.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }
  return out;
}

export function resolveLimitLocale(options = {}) {
  if (typeof options === 'string') return options;
  return options?.locale || null;
}

export function lt(key, params = {}, options = {}) {
  const fullKey = `limits.${key}`;
  const locale = resolveLimitLocale(options);
  const translated = t(fullKey, params, locale ? { locale } : {});
  if (translated !== fullKey) return translated;
  return applyParams(ENGLISH_LIMITS[key] || key, params);
}

export function formatLimitResetsIn(duration, resetTime, options = {}) {
  return `${lt('resets_in', { duration }, options)} (${resetTime})`;
}

export function formatLimitResetsAt(resetTime, options = {}) {
  return lt('resets_at', { time: resetTime }, options);
}

export function formatLocalizedResetTime(isoDate, includeTimezone = true, options = {}) {
  if (typeof includeTimezone === 'object') return formatLocalizedResetTime(isoDate, true, includeTimezone);
  const locale = resolveLimitLocale(options);
  if (!isoDate) return null;

  try {
    const date = dayjs(isoDate).utc();
    if (!date.isValid()) return isoDate;

    if (locale && locale !== 'en') {
      const localeTag = locale === 'ru' ? 'ru-RU' : locale === 'zh' ? 'zh-CN' : locale === 'hi' ? 'hi-IN' : locale;
      const formatted = new Intl.DateTimeFormat(localeTag, {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(date.toDate())
        .replace(/\s*г\./g, '')
        .replace(',', '');
      return includeTimezone ? `${formatted} UTC` : formatted;
    }

    const timeStr = date.format('MMM D, h:mma');
    return includeTimezone ? `${timeStr} UTC` : timeStr;
  } catch {
    return isoDate;
  }
}

function formatDurationFromParts(parts, options = {}) {
  const locale = resolveLimitLocale(options);
  const labels =
    locale && locale !== 'en'
      ? {
          d: lt('duration_day_short', {}, { locale }),
          h: lt('duration_hour_short', {}, { locale }),
          m: lt('duration_minute_short', {}, { locale }),
          s: lt('duration_second_short', {}, { locale }),
        }
      : { d: 'd', h: 'h', m: 'm', s: 's' };
  const spacer = locale && locale !== 'en' ? ' ' : '';
  return parts
    .filter(part => part.value > 0 || part.always)
    .map(part => `${part.value}${spacer}${labels[part.unit]}`)
    .join(' ');
}

export function localizeCompactDuration(duration, options = {}) {
  const locale = resolveLimitLocale(options);
  if (!duration || !locale || locale === 'en') return duration;
  const matches = [...String(duration).matchAll(/(\d+)\s*([dhms])/g)];
  if (matches.length === 0) return duration;
  return formatDurationFromParts(
    matches.map(match => ({ value: Number(match[1]), unit: match[2] })),
    { locale }
  );
}

export function formatLocalizedRelativeTime(isoDate, options = {}) {
  const locale = resolveLimitLocale(options);
  if (!isoDate) return null;

  try {
    const target = dayjs(isoDate);
    if (!target.isValid()) return null;

    const diffMs = target.diff(dayjs());
    if (diffMs < 0) return null;

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    if (!locale || locale === 'en') return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
    if (days > 0) {
      return formatDurationFromParts(
        [
          { value: days, unit: 'd' },
          { value: hours, unit: 'h' },
          { value: minutes, unit: 'm' },
        ],
        { locale }
      );
    }
    return formatDurationFromParts(
      [
        { value: hours, unit: 'h', always: true },
        { value: minutes, unit: 'm' },
      ],
      { locale }
    );
  } catch {
    return null;
  }
}

export function formatLocalizedCurrentTime(options = {}) {
  return formatLocalizedResetTime(new Date().toISOString(), true, options);
}
