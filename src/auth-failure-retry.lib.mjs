/**
 * Re-verify unconfirmed authentication failures before stopping a run (issue #4053).
 *
 * Claude Code reports every generic 401/403 with the machine code
 * `authentication_failed` — including a Cloudflare challenge page
 * ("API Error: 403 Attention Required! | Cloudflare") served while
 * status.claude.com showed an authentication incident. hive-mind treated that
 * code as proof of an expired login and stopped the whole run on the first
 * occurrence; a minute later `claude -p hi` worked again.
 *
 * Policy, applied only to results flagged `verifiable` by detectSubscriptionError():
 *   - retry (session preserved) up to HIVE_MIND_MAX_AUTH_FAILURE_RETRIES times
 *     with exponential backoff from HIVE_MIND_INITIAL_AUTH_FAILURE_RETRY_DELAY_MS;
 *   - while the provider status page reports an incident or degraded component,
 *     keep retrying up to the shared transient budget (count and 12 h window);
 *   - when retries are exhausted, stop exactly as before, but the report states
 *     how often the error was re-checked and what the status page said.
 * Explicit wordings ("OAuth token revoked", "login expired", billing, disabled
 * organization, …) are never `verifiable` and still stop at once.
 */

import { retryLimits } from './config.lib.mjs';
import { fetchProviderStatus, formatProviderStatusSummary } from './provider-status.lib.mjs';
import { formatRetryDuration, getRetryDelayMs } from './tool-retry.lib.mjs';
import { detectSubscriptionError, isEdgeBlockedResponse, isTransientAuthError } from './subscription-error.lib.mjs';

/**
 * Turn a bare "401 Unauthorized"-style failure from a tool without structured
 * error codes (e.g. Codex) into a claim plan() can re-verify. Explicit provider
 * wordings recognized by detectSubscriptionError() (revoked/expired tokens,
 * billing, …) are returned as-is and stay terminal.
 */
export const buildAuthFailureClaim = ({ tool, message, label, apiErrorStatus = null }) => {
  const text = String(message || '');
  const explicit = detectSubscriptionError({ message: text, tool });
  if (explicit) return explicit;
  const transientEvidence = isEdgeBlockedResponse(text) ? 'edge_block' : isTransientAuthError(text) ? 'transient_wording' : null;
  return { isSubscriptionError: true, kind: 'login_required', label, code: null, message: text, apiErrorStatus, verifiable: true, transientEvidence };
};

const formatDelay = ms => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)}s`);

/**
 * @param {Object} options
 * @param {string} options.tool - 'claude', 'codex', …
 * @param {Object} options.budget - shared createTransientRetryBudget() instance
 * @param {Function} options.log
 */
export const createAuthFailureRetry = ({ tool, budget, log, fetchStatus = fetchProviderStatus, limits = retryLimits, now = () => Date.now() } = {}) => {
  let attempts = 0;
  let startedAt = null;
  let seenRecoveries = budget?.recoveries ?? 0;
  return {
    get attempts() {
      return attempts;
    },
    /** Provider progress ends the previous auth outage (also detected automatically through budget.recoveries). */
    reset() {
      attempts = 0;
      startedAt = null;
    },
    /**
     * Decide whether to retry a detected subscription/auth error.
     * @returns {Promise<{retry: true, delayMs: number, status: Object} | {retry: false, subscriptionError: Object}>}
     */
    async plan(subscriptionError) {
      if (!subscriptionError?.verifiable) return { retry: false, subscriptionError };
      if (budget && budget.recoveries !== seenRecoveries) {
        seenRecoveries = budget.recoveries;
        this.reset();
      }
      const status = await fetchStatus(tool, { log });
      const statusSummary = formatProviderStatusSummary(status);
      const extended = Boolean(status?.hasIssues);
      const maxRetries = extended ? Math.max(limits.maxTransientErrorRetries, limits.maxAuthFailureRetries) : limits.maxAuthFailureRetries;
      const delayOptions = { retryCount: attempts, maxRetries, initialDelayMs: limits.initialAuthFailureRetryDelayMs, maxDelayMs: limits.maxAuthFailureRetryDelayMs };
      const decision = budget ? budget.evaluate(delayOptions) : { allowed: attempts < maxRetries, delayMs: getRetryDelayMs(delayOptions), reason: 'count', maxRetries };
      const toolName = String(tool || 'tool').toUpperCase();
      const evidence = [subscriptionError.code && `code=${subscriptionError.code}`, subscriptionError.apiErrorStatus && `HTTP ${subscriptionError.apiErrorStatus}`, subscriptionError.transientEvidence && `evidence=${subscriptionError.transientEvidence}`].filter(Boolean).join(', ');
      if (decision.allowed) {
        if (startedAt === null) startedAt = now();
        budget?.grant();
        attempts += 1;
        await log(`\n⚠️ ${toolName} reported "${subscriptionError.label}" (${evidence || 'no code'}) — not confirmed yet, the provider uses this code for temporary 401/403 failures too (issue #4053).`, { level: 'warning' });
        await log(`   Retry ${attempts}/${maxRetries} in ${formatDelay(decision.delayMs)} (session preserved)${extended ? ' — extended because the status page reports an active issue' : ''}${budget ? ` (${budget.describeProgress()})` : ''}.`, { level: 'warning' });
        if (statusSummary) await log(`   Status page: ${statusSummary}`);
        await log(`   Provider said: ${String(subscriptionError.message || '').substring(0, 300)}`, { verbose: true });
        return { retry: true, delayMs: decision.delayMs, status, extended };
      }
      const elapsed = startedAt === null ? null : formatRetryDuration(Math.max(0, now() - startedAt));
      if (attempts > 0) {
        const why = budget && decision.reason === 'budget' ? budget.describeExhaustion(decision) : `${attempts} retr${attempts === 1 ? 'y' : 'ies'} did not clear it`;
        await log(`\n❌ ${toolName} authentication failure persisted: ${why}${elapsed ? ` over ${elapsed}` : ''}. Treating it as confirmed.`, { level: 'error' });
      }
      return { retry: false, subscriptionError: { ...subscriptionError, verification: { retries: attempts, elapsed, statusSummary: statusSummary || null, extended } } };
    },
    /**
     * plan() plus the retry side effects: keep the session, wait, announce.
     * The caller re-runs the tool when `retry` is true, otherwise uses the annotated error.
     */
    async retryOrConfirm(subscriptionError, { sessionId = null, argv = null, waitForRetryDelay } = {}) {
      if (!subscriptionError?.verifiable) return { retry: false, subscriptionError };
      const decision = await this.plan(subscriptionError);
      if (!decision.retry) return decision;
      if (sessionId && argv && !argv.resume) argv.resume = sessionId;
      await waitForRetryDelay(decision.delayMs, log);
      await log('\n🔄 Retrying now...');
      return decision;
    },
  };
};

export default { buildAuthFailureClaim, createAuthFailureRetry };
