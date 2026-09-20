/**
 * Subscription / account-access error detection for AI CLI tools.
 *
 * Issue #2161: a `/solve` run died after 4h11m and $31.39 of work with nothing
 * but the generic line
 *
 *   ❌ CLAUDE execution failed with Your organization has disabled Claude
 *      subscription access for Claude Code · Use an Anthropic API key instead,
 *      or ask your admin to enable access
 *
 * That sentence is not a transient API fault and not a usage limit: it means the
 * *account itself* is no longer permitted to use the tool. Waiting does not help,
 * retrying does not help, switching to a fallback model does not help — the run
 * must stop immediately, preserve the work, and tell the operator exactly what to
 * do.
 *
 * This module is the single place that recognises that whole class of errors for
 * every tool hive-mind can drive. Two detection layers are used, strongest first:
 *
 *   1. Machine-readable codes emitted by the tool (Claude Code's `error` field on
 *      stream-json `assistant`/`result` events, Codex's auth error codes). These
 *      are exact and locale independent.
 *   2. Verbatim user-facing strings, transcribed from the shipped CLI binaries
 *      (see docs/case-studies/issue-2161/provider-error-strings.md). Used when
 *      only the rendered message survives (most tools give us nothing else).
 *
 * Deliberately NOT matched here:
 *   - "Authentication error · This may be a temporary network issue, please try
 *     again" — Claude Code's own wording says it is transient, so it belongs to
 *     the retry path, not to this terminal path.
 *   - Usage/quota limits ("You've hit your usage limit", "resets 5am") — those
 *     have a reset time and are handled by usage-limit.lib.mjs.
 */

/** Emitted verbatim into the log so /hive, the Telegram monitor and humans can grep for it. */
export const SUBSCRIPTION_BLOCKED_MARKER = '🚫 SUBSCRIPTION/ACCESS BLOCKED';

export const SUBSCRIPTION_ERROR_KINDS = {
  ORG_SUBSCRIPTION_DISABLED: 'org_subscription_disabled',
  ACCOUNT_NO_ACCESS: 'account_no_access',
  LOGIN_REQUIRED: 'login_required',
  BILLING: 'billing',
  PLAN_RESTRICTED: 'plan_restricted',
  API_KEY_INVALID: 'api_key_invalid',
};

const K = SUBSCRIPTION_ERROR_KINDS;

/**
 * Machine-readable codes → kind. Sources:
 *   - Claude Code CLI 2.1.233, blocked-state switch (`oauth_org_not_allowed`,
 *     `authentication_failed`, `billing_error`, …).
 *   - Codex CLI 0.147.0 auth error codes (`missing_codex_entitlement`,
 *     `refresh_token_expired`, `disabled_by_admin`, `plan_not_eligible`, …).
 */
export const SUBSCRIPTION_ERROR_CODES = Object.freeze({
  // Claude Code
  oauth_org_not_allowed: K.ORG_SUBSCRIPTION_DISABLED,
  authentication_failed: K.LOGIN_REQUIRED,
  token_revoked: K.LOGIN_REQUIRED,
  invalid_api_key: K.API_KEY_INVALID,
  billing_error: K.BILLING,
  credit_balance_low: K.BILLING,
  // Codex
  missing_codex_entitlement: K.ACCOUNT_NO_ACCESS,
  disabled_by_admin: K.ORG_SUBSCRIPTION_DISABLED,
  plan_not_eligible: K.PLAN_RESTRICTED,
  required_app_unavailable: K.ACCOUNT_NO_ACCESS,
  refresh_token_expired: K.LOGIN_REQUIRED,
  refresh_token_invalidated: K.LOGIN_REQUIRED,
  not_chatgpt_auth: K.LOGIN_REQUIRED,
});

/**
 * Substrings that look authentication-ish but are explicitly transient. Checked
 * before every other rule so a network blip is never reported as a cancelled
 * subscription (which would stop the whole hive).
 */
const TRANSIENT_AUTH_PATTERNS = ['this may be a temporary network issue', 'could not authenticate with its upstream provider', 'temporary failure in name resolution'];

/**
 * Verbatim strings from the shipped CLIs, lower-cased. `tool` is informational:
 * a message is matched regardless of which tool produced it, because hive-mind
 * often only sees the rendered text several layers away from its origin.
 */
const MESSAGE_RULES = [
  // ---- Claude Code -------------------------------------------------------
  { kind: K.ORG_SUBSCRIPTION_DISABLED, tool: 'claude', needles: ['organization has disabled claude subscription access'] },
  { kind: K.ORG_SUBSCRIPTION_DISABLED, tool: 'claude', needles: ['organization has disabled api key authentication'] },
  { kind: K.ORG_SUBSCRIPTION_DISABLED, tool: 'claude', needles: ['belongs to a disabled organization'] },
  { kind: K.ORG_SUBSCRIPTION_DISABLED, tool: 'claude', needles: ['organization has been disabled'] },
  { kind: K.ACCOUNT_NO_ACCESS, tool: 'claude', needles: ['your account does not have access to claude'] },
  { kind: K.LOGIN_REQUIRED, tool: 'claude', needles: ['oauth token revoked'] },
  { kind: K.LOGIN_REQUIRED, tool: 'claude', needles: ['login expired'] },
  { kind: K.LOGIN_REQUIRED, tool: 'claude', needles: ['not logged in'] },
  { kind: K.LOGIN_REQUIRED, tool: 'claude', needles: ['session expired. please run /login'] },
  { kind: K.LOGIN_REQUIRED, tool: 'claude', needles: ['oauth session expired and could not be refreshed'] },
  { kind: K.LOGIN_REQUIRED, tool: 'claude', needles: ['anthropic profile login expired'] },
  { kind: K.BILLING, tool: 'claude', needles: ['credit balance is too low'] },
  { kind: K.API_KEY_INVALID, tool: 'claude', needles: ['invalid api key'] },
  { kind: K.API_KEY_INVALID, tool: 'claude', needles: ['invalid auth token'] },
  { kind: K.PLAN_RESTRICTED, tool: 'claude', needles: ['is not available with the claude pro plan'] },
  { kind: K.PLAN_RESTRICTED, tool: 'claude', needles: ['auto mode is unavailable for your plan'] },

  // ---- Codex -------------------------------------------------------------
  { kind: K.ACCOUNT_NO_ACCESS, tool: 'codex', needles: ['you do not have access to codex'] },
  { kind: K.ACCOUNT_NO_ACCESS, tool: 'codex', needles: ['not currently authorized to use codex'] },
  { kind: K.ACCOUNT_NO_ACCESS, tool: 'codex', needles: ['contact your workspace administrator to request access to codex'] },
  { kind: K.LOGIN_REQUIRED, tool: 'codex', needles: ['access token could not be refreshed'] },
  { kind: K.LOGIN_REQUIRED, tool: 'codex', needles: ['oauth refresh token was rejected'] },
  { kind: K.LOGIN_REQUIRED, tool: 'codex', needles: ["not signed in. please run 'codex login'"] },

  // ---- Qwen Code ---------------------------------------------------------
  { kind: K.LOGIN_REQUIRED, tool: 'qwen', needles: ['qwen oauth credentials expired'] },
  { kind: K.LOGIN_REQUIRED, tool: 'qwen', needles: ['refresh token expired or invalid'] },
  { kind: K.LOGIN_REQUIRED, tool: 'qwen', needles: ['failed to obtain valid qwen access token'] },
  { kind: K.PLAN_RESTRICTED, tool: 'qwen', needles: ['coding plan api key not found'] },

  // ---- Gemini CLI --------------------------------------------------------
  { kind: K.LOGIN_REQUIRED, tool: 'gemini', needles: ['please re-authenticate with the correct type'] },
  { kind: K.PLAN_RESTRICTED, tool: 'gemini', needles: ["doesn't have a gemini code assist"] },

  // ---- OpenCode ----------------------------------------------------------
  { kind: K.LOGIN_REQUIRED, tool: 'opencode', needles: ['run `opencode auth login` in the terminal'] },
  { kind: K.LOGIN_REQUIRED, tool: 'opencode', needles: ['oauth token refresh failed and no fallback'] },
  { kind: K.ACCOUNT_NO_ACCESS, tool: 'opencode', needles: ['your account does not have access to ai features'] },

  // ---- Generic provider phrasing (any tool) ------------------------------
  { kind: K.ORG_SUBSCRIPTION_DISABLED, tool: null, needles: ['has disabled', 'subscription access'] },
  { kind: K.BILLING, tool: null, needles: ['subscription', 'expired'] },
  { kind: K.BILLING, tool: null, needles: ['subscription', 'cancel'] },
];

const KIND_LABELS = Object.freeze({
  [K.ORG_SUBSCRIPTION_DISABLED]: 'Subscription access disabled for this organization',
  [K.ACCOUNT_NO_ACCESS]: 'Account is not authorized to use this tool',
  [K.LOGIN_REQUIRED]: 'Authentication expired — re-login required',
  [K.BILLING]: 'Subscription/billing problem',
  [K.PLAN_RESTRICTED]: 'Current plan does not allow this request',
  [K.API_KEY_INVALID]: 'Invalid API key or auth token',
});

const KIND_REASONS = Object.freeze({
  [K.ORG_SUBSCRIPTION_DISABLED]: 'The provider rejected the request because the organization/account behind the subscription is no longer allowed to use this CLI. This is an account-level block, not a rate limit — it will not clear on its own.',
  [K.ACCOUNT_NO_ACCESS]: 'The provider accepted the credentials but the account has no entitlement for this product. Access must be granted before any further run can succeed.',
  [K.LOGIN_REQUIRED]: 'The stored OAuth credentials are gone, revoked or unrefreshable. Every request will fail until the tool is logged in again.',
  [K.BILLING]: 'The subscription is expired, cancelled or out of credit. Requests stay rejected until billing is restored.',
  [K.PLAN_RESTRICTED]: 'The account is authenticated, but the requested model/mode is not included in the current plan.',
  [K.API_KEY_INVALID]: 'The configured API key or auth token was rejected by the provider.',
});

/** Per-tool re-authentication commands, used to build actionable guidance. */
const TOOL_LOGIN_HINTS = Object.freeze({
  claude: 'claude /login  (or set ANTHROPIC_API_KEY for API-key billing)',
  codex: 'codex login  (add --device-auth on a headless machine)',
  qwen: 'qwen  → /auth',
  gemini: 'gemini  → /auth',
  opencode: 'opencode auth login',
  agent: 'agent auth login',
});

const TOOL_ACCOUNT_URLS = Object.freeze({
  claude: 'https://claude.ai/settings/billing',
  codex: 'https://chatgpt.com/codex/settings/usage',
  qwen: 'https://chat.qwen.ai',
  gemini: 'https://codeassist.google.com',
});

const toText = value => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.error?.message === 'string') return value.error.message;
  if (typeof value?.message === 'string') return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * True when the text is an authentication-flavoured error that the provider
 * itself describes as temporary. Such errors must keep using the retry path.
 */
export const isTransientAuthError = value => {
  const lower = toText(value).toLowerCase();
  if (!lower) return false;
  return TRANSIENT_AUTH_PATTERNS.some(p => lower.includes(p));
};

const buildGuidance = (kind, tool) => {
  const loginHint = TOOL_LOGIN_HINTS[tool] || TOOL_LOGIN_HINTS.claude;
  const accountUrl = TOOL_ACCOUNT_URLS[tool] || null;
  const steps = [];
  switch (kind) {
    case K.ORG_SUBSCRIPTION_DISABLED:
      steps.push('Ask the organization/workspace admin to re-enable CLI access for this account.');
      steps.push('Or switch this run to API-key billing instead of the subscription.');
      break;
    case K.ACCOUNT_NO_ACCESS:
      steps.push('Request access for this account from the workspace administrator.');
      steps.push('Verify you are logged in with the account that actually owns the subscription.');
      break;
    case K.LOGIN_REQUIRED:
      steps.push(`Re-authenticate the tool: ${loginHint}`);
      break;
    case K.BILLING:
      steps.push('Renew/reactivate the subscription or top up the credit balance.');
      if (accountUrl) steps.push(`Billing page: ${accountUrl}`);
      break;
    case K.PLAN_RESTRICTED:
      steps.push('Pick a model/mode included in the current plan (see --model), or upgrade the plan.');
      steps.push(`After a plan change, re-login so the new entitlements are picked up: ${loginHint}`);
      break;
    case K.API_KEY_INVALID:
      steps.push('Fix or regenerate the configured API key / auth token, then re-run.');
      break;
    default:
      steps.push(`Re-authenticate the tool: ${loginHint}`);
  }
  steps.push('Once access is restored, resume with the session ID printed above — no work is lost.');
  return steps;
};

/**
 * Detect an account/subscription-level block.
 *
 * @param {string|Object} input - Raw message, or a descriptor:
 *   { message, tool, errorCode, apiErrorStatus, terminalReason }
 * @returns {null|{isSubscriptionError: true, kind, code, tool, label, reason, message, guidance, apiErrorStatus}}
 */
export const detectSubscriptionError = input => {
  const descriptor = typeof input === 'string' || input === null || input === undefined ? { message: input } : input;
  const message = toText(descriptor.message ?? descriptor);
  const tool = descriptor.tool ? String(descriptor.tool).toLowerCase() : null;
  const rawCode = descriptor.errorCode ? String(descriptor.errorCode).toLowerCase().trim() : null;
  const apiErrorStatus = Number.isFinite(descriptor.apiErrorStatus) ? descriptor.apiErrorStatus : null;

  // Layer 1: machine-readable code. Trusted even when the message is missing.
  if (rawCode && Object.hasOwn(SUBSCRIPTION_ERROR_CODES, rawCode)) {
    const kind = SUBSCRIPTION_ERROR_CODES[rawCode];
    return {
      isSubscriptionError: true,
      kind,
      code: rawCode,
      tool,
      label: KIND_LABELS[kind],
      reason: KIND_REASONS[kind],
      message,
      apiErrorStatus,
      guidance: buildGuidance(kind, tool),
    };
  }

  if (!message) return null;
  const lower = message.toLowerCase();
  if (isTransientAuthError(lower)) return null;

  // Layer 2: verbatim provider strings.
  for (const rule of MESSAGE_RULES) {
    if (!rule.needles.every(n => lower.includes(n))) continue;
    return {
      isSubscriptionError: true,
      kind: rule.kind,
      code: rawCode || null,
      tool: tool || rule.tool || null,
      label: KIND_LABELS[rule.kind],
      reason: KIND_REASONS[rule.kind],
      message,
      apiErrorStatus,
      guidance: buildGuidance(rule.kind, tool || rule.tool),
    };
  }
  return null;
};

/** Convenience boolean wrapper mirroring isUsageLimitError(). */
export const isSubscriptionBlockedError = input => detectSubscriptionError(input) !== null;

/**
 * Render the terminal/log block. The first line is SUBSCRIPTION_BLOCKED_MARKER so
 * downstream consumers (/hive worker output scanner, Telegram session monitor,
 * `grep`) have one stable anchor.
 *
 * @returns {string[]} lines
 */
export const formatSubscriptionErrorReport = (info, { tool = null, sessionId = null, tempDir = null, branchName = null, committed = null, resumeCommand = null } = {}) => {
  if (!info) return [];
  const toolName = (info.tool || tool || 'tool').toUpperCase();
  const lines = [];
  lines.push('');
  lines.push(`${SUBSCRIPTION_BLOCKED_MARKER} — ${toolName}: ${info.label}`);
  lines.push(`   Provider said: ${info.message || '(no message)'}`);
  if (info.code) lines.push(`   Error code: ${info.code}${info.apiErrorStatus ? ` (HTTP ${info.apiErrorStatus})` : ''}`);
  else if (info.apiErrorStatus) lines.push(`   HTTP status: ${info.apiErrorStatus}`);
  lines.push(`   Why this stops the run: ${info.reason}`);
  lines.push('   This is NOT a usage limit and NOT a transient API error — retrying, waiting for a reset');
  lines.push('   or switching to a fallback model cannot fix it, so the task is stopped now.');
  lines.push('');
  lines.push('   What to do:');
  for (const step of info.guidance || []) lines.push(`     • ${step}`);
  if (committed === true) lines.push('   💾 Uncommitted changes were auto-committed and pushed before stopping.');
  else if (committed === false) lines.push('   ⚠️  No uncommitted changes to preserve (working tree was clean).');
  if (tempDir) lines.push(`   📁 Working directory: ${tempDir}`);
  if (branchName) lines.push(`   🌿 Branch: ${branchName}`);
  if (sessionId) lines.push(`   📌 Session ID: ${sessionId}`);
  if (resumeCommand) lines.push(`   ▶️  Resume after access is restored: ${resumeCommand}`);
  lines.push('');
  return lines;
};

/** One-line summary used for exit messages, PR comments and commit reasons. */
export const formatSubscriptionErrorSummary = (info, { tool = null } = {}) => {
  if (!info) return '';
  const toolName = (info.tool || tool || 'tool').toUpperCase();
  return `${toolName} stopped: ${info.label}${info.code ? ` [${info.code}]` : ''} — ${info.message || ''}`.trim();
};

export default {
  SUBSCRIPTION_BLOCKED_MARKER,
  SUBSCRIPTION_ERROR_KINDS,
  SUBSCRIPTION_ERROR_CODES,
  detectSubscriptionError,
  isSubscriptionBlockedError,
  isTransientAuthError,
  formatSubscriptionErrorReport,
  formatSubscriptionErrorSummary,
};
