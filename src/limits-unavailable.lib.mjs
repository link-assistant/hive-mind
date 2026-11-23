/**
 * Temporary /limits failures (issue #4053).
 *
 * A provider usage endpoint that answers HTTP 503 (or 5xx, 408, 425, a timeout,
 * or a network error) is not telling us anything about the account: the limits
 * are simply unavailable *right now*. Before #4053 /limits printed the raw
 * "Failed to fetch usage from API: 503", which read like a permanent failure.
 * These helpers give such failures `failureKind: 'temporary'` (never cached by
 * getCachedUsageLimits, so the next /limits call retries) and a localized
 * message that says exactly that.
 */

import { lt, resolveLimitLocale } from './limits-i18n.lib.mjs';

const PROVIDER_LABELS = Object.freeze({ claude: 'Claude', codex: 'Codex' });

/** HTTP statuses that describe the provider's state, not the account's. */
export function isTemporaryLimitsHttpStatus(status) {
  const code = Number(status);
  return Number.isInteger(code) && (code >= 500 || code === 408 || code === 425);
}

/**
 * Build the failure result for a temporarily unavailable usage endpoint.
 *
 * @param {'claude'|'codex'|string} provider
 * @param {{status?: number, statusText?: string, cause?: 'timeout'|'network'}} details
 */
export function temporaryLimitsFailure(provider, { status = null, statusText = '', cause = null } = {}) {
  const result = { success: false, failureKind: 'temporary', provider, httpStatus: status ?? null, httpStatusText: statusText || '', cause: cause || (status ? 'http' : 'network') };
  result.error = describeLimitsFailure(result);
  return result;
}

/** Map a caught fetch error to a temporary-failure cause. */
export function limitsFetchErrorCause(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network';
}

function reasonText(result, locale) {
  if (result.cause === 'timeout') return lt('retry_reason_timeout', {}, { locale });
  if (result.cause === 'network' || !result.httpStatus) return lt('retry_reason_network', {}, { locale });
  return `HTTP ${result.httpStatus}${result.httpStatusText ? ` ${result.httpStatusText}` : ''}`;
}

/**
 * Text to show for a failed limits lookup. Temporary failures get the
 * localized "temporarily unavailable … retried on the next /limits call"
 * sentence; every other failure keeps its own error message.
 */
export function describeLimitsFailure(result, options = {}) {
  if (!result || result.success) return null;
  if (result.failureKind !== 'temporary') return result.error || lt('unavailable', {}, options);
  const locale = resolveLimitLocale(options);
  const provider = PROVIDER_LABELS[String(result.provider || '').toLowerCase()] || result.provider || '';
  return lt('temporarily_unavailable', { provider, reason: reasonText(result, locale) }, { locale });
}

export default { isTemporaryLimitsHttpStatus, temporaryLimitsFailure, limitsFetchErrorCause, describeLimitsFailure };
