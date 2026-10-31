/**
 * Subscription metadata helpers for the /limits command.
 *
 * Surfaces the subscription end / trial end / status fields the underlying
 * providers expose:
 *   - Claude: GET https://api.anthropic.com/api/oauth/profile
 *   - Codex:  decoded id_token from ~/.codex/auth.json
 *
 * See `docs/case-studies/issue-1793/`.
 */

import { CACHE_TTL, claudeLimitsAuthAdmission, codexLimitsAuthAdmission, decodeJwtPayload, getLimitCache, readCodexAuth, readCredentials, resolveLimitsCredentialPaths } from './limits.lib.mjs';
import { formatLocalizedRelativeTime, formatLocalizedResetTime, formatSubscriptionEnds, formatSubscriptionStatus, formatTrialEnds, lt, resolveLimitLocale } from './limits-i18n.lib.mjs';
import { captureLimitsAuthentication, changedLimitsAuthentication, getCachedUsageLimits } from './usage-limits-cache.lib.mjs';
import { getSelectedRouterLimits } from './limits-router.lib.mjs';

const PROFILE_API_ENDPOINT = 'https://api.anthropic.com/api/oauth/profile';

/**
 * Render the localized "Subscription ends …" / "Trial ends …" / "Subscription: …"
 * line for a tool. Returns '' when no displayable data is present.
 */
export function formatSubscriptionLines(subscription, options = {}) {
  if (!subscription) return '';
  const locale = resolveLimitLocale(options);
  const buildLine = (iso, formatter) => {
    const resetTime = formatLocalizedResetTime(iso, true, { locale });
    return resetTime ? formatter(formatLocalizedRelativeTime(iso, { locale }), resetTime, { locale }) : null;
  };
  let line = null;
  if (subscription.endsAt) line = buildLine(subscription.endsAt, formatSubscriptionEnds);
  else if (subscription.trialEndsAt) line = buildLine(subscription.trialEndsAt, formatTrialEnds);
  else if (subscription.status) line = formatSubscriptionStatus(subscription.status, { locale });
  return line ? `${line}\n` : '';
}

function humanizePlanType(planType, provider) {
  if (!planType) return '';
  const providerPrefix = provider === 'claude' ? /^claude[\s_-]*/i : /^(chatgpt|codex|openai)[\s_-]*/i;
  const normalized = String(planType).trim().replace(providerPrefix, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized
    .split(' ')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatSubscriptionDetail(subscription, options = {}) {
  if (!subscription) return '';
  const locale = resolveLimitLocale(options);
  const buildDetail = (iso, inKey, atKey) => {
    const resetTime = formatLocalizedResetTime(iso, true, { locale });
    if (!resetTime) return '';
    const duration = formatLocalizedRelativeTime(iso, { locale });
    return duration ? lt(inKey, { duration, time: resetTime }, { locale }) : lt(atKey, { time: resetTime }, { locale });
  };

  if (subscription.endsAt) return buildDetail(subscription.endsAt, 'subscription_detail_ends_in', 'subscription_detail_ends');
  if (subscription.trialEndsAt) return buildDetail(subscription.trialEndsAt, 'subscription_detail_trial_ends_in', 'subscription_detail_trial_ends');
  return subscription.status ? String(subscription.status).trim() : '';
}

export function formatSubscriptionHeading(provider, subscription, options = {}) {
  const locale = resolveLimitLocale(options);
  const normalizedProvider = provider === 'claude' ? 'claude' : 'chatgpt';
  const planType = subscription?.planType || options?.planType || null;
  if (!subscription && !planType) return '';

  const plan = humanizePlanType(planType, normalizedProvider);
  const titleKey = normalizedProvider === 'claude' ? 'claude_subscription_title' : 'chatgpt_subscription_title';
  const title = lt(titleKey, { plan: plan ? ` ${plan}` : '' }, { locale });
  const details = [subscription?.source === 'stored-token' ? lt('stored_metadata', {}, { locale }) : subscription?.source === 'router' ? 'Router' : '', formatSubscriptionDetail(subscription, { locale })].filter(Boolean);
  const detail = details.join('; ');
  return detail ? `${title} (${detail})` : title;
}

/**
 * Get Claude subscription metadata.
 *
 * Reads `~/.claude/.credentials.json` and queries Anthropic's
 * `/api/oauth/profile` endpoint to surface what is currently published:
 *   - subscription_status ("active" / "inactive")
 *   - subscription_created_at (ISO timestamp)
 *   - claude_code_trial_ends_at (ISO timestamp; trials only)
 *   - subscriptionType from local creds (informational plan label)
 *
 * Anthropic does NOT currently expose a `subscription_ends_at` field for
 * paid plans, so we never fabricate one. The renderer only emits a line
 * when a value is available.
 *
 * @param {Object} opts
 * @param {boolean} opts.verbose - Verbose logging
 * @param {string} opts.credentialsPath - Override Claude credentials path
 * @returns {Object} `{ success, subscription? , error? }`
 */
export async function getClaudeSubscriptionInfo({ verbose = false, credentialsPath = resolveLimitsCredentialPaths().claude } = {}) {
  const routed = await getSelectedRouterLimits('claude', { verbose });
  if (routed) return routed;
  try {
    const authenticationUnchanged = await captureLimitsAuthentication(credentialsPath, claudeLimitsAuthAdmission(credentialsPath, verbose));
    const credentials = await readCredentials(credentialsPath, verbose);
    if (!credentials) {
      return {
        success: false,
        error: 'Could not read Claude credentials. Make sure Claude is properly installed and authenticated.',
      };
    }

    const accessToken = credentials?.claudeAiOauth?.accessToken;
    const planType = credentials?.claudeAiOauth?.subscriptionType || null;

    if (!accessToken) {
      return {
        success: false,
        error: 'No access token found in Claude credentials.',
      };
    }

    const requestHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-code/2.0.55',
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
    };

    if (verbose) {
      console.log(`[VERBOSE] /limits subscription: GET ${PROFILE_API_ENDPOINT}`);
    }

    if (!(await authenticationUnchanged())) return changedLimitsAuthentication();
    const response = await fetch(PROFILE_API_ENDPOINT, { method: 'GET', headers: requestHeaders, signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      if (verbose) {
        console.error(`[VERBOSE] /limits subscription HTTP ${response.status}`);
      }
      await response.body?.cancel();
      if (!(await authenticationUnchanged())) return changedLimitsAuthentication();
      return {
        success: false,
        error: `Failed to fetch Claude profile: HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    if (!(await authenticationUnchanged())) return changedLimitsAuthentication();
    const organization = data?.organization || {};
    const account = data?.account || {};
    // Entitlements from an authenticated profile take precedence over a label
    // cached before a cancellation/downgrade. A cancelled renewal can retain
    // paid access until the billing period ends, so status alone is insufficient.
    const currentPlan = account.has_claude_max === true ? 'max' : account.has_claude_pro === true ? 'pro' : account.has_claude_max === false && account.has_claude_pro === false ? 'free' : planType;
    if (verbose) {
      console.log('[VERBOSE] /limits Claude subscription: authenticated profile received.');
    }
    return {
      success: true,
      subscription: {
        planType: currentPlan,
        source: 'authenticated-profile',
        status: organization.subscription_status || null,
        createdAt: organization.subscription_created_at || null,
        trialEndsAt: organization.claude_code_trial_ends_at || null,
        endsAt: organization.subscription_ends_at || null,
      },
    };
  } catch (error) {
    if (verbose) console.error('[VERBOSE] /limits subscription error:', error.name);
    return { success: false, error: 'Failed to get Claude subscription info. Check connectivity and the provider response format.' };
  }
}

/**
 * Get Codex subscription metadata.
 *
 * Decodes the OIDC `id_token` persisted in `~/.codex/auth.json`. The token's
 * `https://api.openai.com/auth` claim can carry a stored subscription window.
 * This is unverified cached metadata, not a current authenticated entitlement
 * check; access credentials can already be expired. No HTTP call is made.
 *
 * @param {Object} opts
 * @param {boolean} opts.verbose
 * @param {string} opts.authPath
 * @returns {Object} `{ success, subscription? , error? }`
 */
export async function getCodexSubscriptionInfo({ verbose = false, authPath = resolveLimitsCredentialPaths().codex } = {}) {
  const routed = await getSelectedRouterLimits('codex', { verbose });
  if (routed) return routed;
  try {
    const auth = await readCodexAuth(authPath, verbose);
    if (!auth) {
      return {
        success: false,
        error: 'Could not read Codex authentication.',
      };
    }

    if (auth.auth_mode && auth.auth_mode !== 'chatgpt') {
      return {
        success: false,
        error: 'Codex subscription info is only available for ChatGPT-authenticated Codex.',
      };
    }

    const idToken = auth?.tokens?.id_token || null;
    const accessToken = auth?.tokens?.access_token || null;
    const payload = decodeJwtPayload(idToken) || decodeJwtPayload(accessToken);
    const claims = payload?.['https://api.openai.com/auth'] || null;

    if (!claims) {
      return {
        success: false,
        error: 'Could not decode Codex subscription claims from id_token.',
      };
    }

    return {
      success: true,
      subscription: {
        source: 'stored-token',
        planType: claims.chatgpt_plan_type || null,
        activeStart: claims.chatgpt_subscription_active_start || null,
        endsAt: claims.chatgpt_subscription_active_until || null,
        lastChecked: claims.chatgpt_subscription_last_checked || null,
      },
    };
  } catch (error) {
    if (verbose) console.error('[VERBOSE] /limits Codex subscription error:', error.name);
    return { success: false, error: 'Failed to get Codex subscription info. Check the stored authentication format.' };
  }
}

/**
 * Cached Claude subscription metadata. Uses the same 20-minute
 * TTL as `/limits` so we don't add traffic to the Anthropic OAuth API.
 */
export async function getCachedClaudeSubscription(verbose = false, { credentialsPath = resolveLimitsCredentialPaths().claude } = {}) {
  const routed = await getSelectedRouterLimits('claude', { verbose });
  if (routed) return routed;
  return getCachedUsageLimits({ key: 'claude-subscription', credentialsPath, verbose, cache: getLimitCache(), ttlMs: CACHE_TTL.USAGE_API, validateCredentials: claudeLimitsAuthAdmission(credentialsPath, verbose), fetchLimits: () => getClaudeSubscriptionInfo({ verbose, credentialsPath }) });
}

/**
 * Cached Codex subscription metadata. The JWT decode is local, but we still
 * cache for parity with the rest of the /limits pipeline.
 */
export async function getCachedCodexSubscription(verbose = false, { authPath = resolveLimitsCredentialPaths().codex } = {}) {
  const routed = await getSelectedRouterLimits('codex', { verbose });
  if (routed) return routed;
  return getCachedUsageLimits({ key: 'codex-subscription', credentialsPath: authPath, verbose, cache: getLimitCache(), ttlMs: CACHE_TTL.USAGE_API, validateCredentials: codexLimitsAuthAdmission(authPath, verbose), fetchLimits: () => getCodexSubscriptionInfo({ verbose, authPath }) });
}
