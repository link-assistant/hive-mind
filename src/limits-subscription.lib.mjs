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

import { CACHE_TTL, DEFAULT_CODEX_AUTH_PATH, DEFAULT_CREDENTIALS_PATH, decodeJwtPayload, getLimitCache, readCodexAuth, readCredentials } from './limits.lib.mjs';
import { formatLocalizedRelativeTime, formatLocalizedResetTime, formatSubscriptionEnds, formatSubscriptionStatus, formatTrialEnds, resolveLimitLocale } from './limits-i18n.lib.mjs';

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
export async function getClaudeSubscriptionInfo({ verbose = false, credentialsPath = DEFAULT_CREDENTIALS_PATH } = {}) {
  try {
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

    const response = await fetch(PROFILE_API_ENDPOINT, { method: 'GET', headers: requestHeaders });
    if (!response.ok) {
      if (verbose) {
        console.error(`[VERBOSE] /limits subscription HTTP ${response.status} ${response.statusText}`);
      }
      return {
        success: false,
        error: `Failed to fetch Claude profile: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    if (verbose) {
      console.log('[VERBOSE] /limits subscription body:', JSON.stringify(data, null, 2));
    }

    const organization = data?.organization || {};
    return {
      success: true,
      subscription: {
        planType,
        status: organization.subscription_status || null,
        createdAt: organization.subscription_created_at || null,
        trialEndsAt: organization.claude_code_trial_ends_at || null,
        endsAt: organization.subscription_ends_at || null,
      },
    };
  } catch (error) {
    if (verbose) console.error('[VERBOSE] /limits subscription error:', error);
    return { success: false, error: `Failed to get Claude subscription info: ${error.message}` };
  }
}

/**
 * Get Codex subscription metadata.
 *
 * Decodes the OIDC `id_token` persisted in `~/.codex/auth.json`. The token's
 * `https://api.openai.com/auth` claim carries the active ChatGPT subscription
 * window — including `chatgpt_subscription_active_until`, which is exactly
 * the renewal/end date the issue asks for. No HTTP call is needed.
 *
 * @param {Object} opts
 * @param {boolean} opts.verbose
 * @param {string} opts.authPath
 * @returns {Object} `{ success, subscription? , error? }`
 */
export async function getCodexSubscriptionInfo({ verbose = false, authPath = DEFAULT_CODEX_AUTH_PATH } = {}) {
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
        planType: claims.chatgpt_plan_type || null,
        activeStart: claims.chatgpt_subscription_active_start || null,
        endsAt: claims.chatgpt_subscription_active_until || null,
        lastChecked: claims.chatgpt_subscription_last_checked || null,
      },
    };
  } catch (error) {
    if (verbose) console.error('[VERBOSE] /limits Codex subscription error:', error);
    return { success: false, error: `Failed to get Codex subscription info: ${error.message}` };
  }
}

/**
 * Cached Claude subscription metadata. Uses the same 20-minute
 * TTL as `/limits` so we don't add traffic to the Anthropic OAuth API.
 */
export async function getCachedClaudeSubscription(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('claude-subscription', CACHE_TTL.USAGE_API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached Claude subscription');
    return cached;
  }
  const result = await getClaudeSubscriptionInfo({ verbose });
  if (result.success) cache.set('claude-subscription', result, CACHE_TTL.USAGE_API);
  return result;
}

/**
 * Cached Codex subscription metadata. The JWT decode is local, but we still
 * cache for parity with the rest of the /limits pipeline.
 */
export async function getCachedCodexSubscription(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('codex-subscription', CACHE_TTL.USAGE_API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached Codex subscription');
    return cached;
  }
  const result = await getCodexSubscriptionInfo({ verbose });
  if (result.success) cache.set('codex-subscription', result, CACHE_TTL.USAGE_API);
  return result;
}
