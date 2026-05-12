import { t } from './i18n.lib.mjs';

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
  requests: 'requests',
  resets_at: 'Resets {{time}}',
  resets_in: 'Resets in {{duration}}',
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
