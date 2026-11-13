#!/usr/bin/env node
/**
 * examples/auth-failure-retry-demo.mjs
 *
 * Shows how hive-mind decides whether an authentication error stops a run
 * (issue #4053). The provider's message is classified, then the retry policy
 * plans what to do, consulting the live provider status page.
 *
 *   - A generic `authentication_failed` (e.g. a Cloudflare 403 challenge page
 *     during an incident) is "unconfirmed": it is retried with the session
 *     preserved, for longer while the status page reports an issue.
 *   - An explicit wording ("OAuth token revoked", billing, ...) stops at once.
 *
 * Nothing is executed and no wait happens; only the decisions are printed.
 *
 * Usage:
 *   node examples/auth-failure-retry-demo.mjs
 *   node examples/auth-failure-retry-demo.mjs "Failed to authenticate. API Error: 401 Invalid bearer token" authentication_failed 401
 */
import { detectSubscriptionError, formatSubscriptionDetectionLine } from '../src/subscription-error.lib.mjs';
import { createAuthFailureRetry } from '../src/auth-failure-retry.lib.mjs';

const [customMessage, customCode, customStatus] = process.argv.slice(2);
const cases = customMessage
  ? [{ message: customMessage, errorCode: customCode || null, apiErrorStatus: customStatus ? Number(customStatus) : null }]
  : [
      { message: 'Failed to authenticate. API Error: 403 Attention Required! | Cloudflare', errorCode: 'authentication_failed', apiErrorStatus: 403 },
      { message: 'OAuth token revoked. Please run /login', errorCode: 'authentication_failed', apiErrorStatus: 401 },
    ];

const log = async message => console.log(message);
for (const input of cases) {
  console.log(`\n=== ${input.message}`);
  const detected = detectSubscriptionError({ ...input, tool: 'claude' });
  if (!detected) {
    console.log('Not an access error: handled by the ordinary error/retry paths.');
    continue;
  }
  console.log(formatSubscriptionDetectionLine(detected));
  const retry = createAuthFailureRetry({ tool: 'claude', log });
  const decision = await retry.plan(detected);
  console.log(decision.retry ? `→ retry after ${Math.round(decision.delayMs / 1000)}s (extended: ${decision.extended})` : '→ stop the run now: the provider stated the reason explicitly');
}
