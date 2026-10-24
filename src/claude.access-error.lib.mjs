/** Issue #3759: recover access diagnostics when Claude omits its terminal event. */
import { detectSubscriptionError, SUBSCRIPTION_BLOCKED_MARKER } from './subscription-error.lib.mjs';
import { resolveClaudeUsageLimit } from './claude.usage-limit-sources.lib.mjs';
import { selectClaudeFailureMessage } from './claude.process-exit.lib.mjs';

export const resolveClaudeAccessError = async ({ lastMessage, evidence, transcript, log = async () => {} } = {}) => {
  const facts = evidence?.snapshot ? evidence.snapshot() : evidence || {};
  const sources = [
    { source: 'last message', message: lastMessage },
    { source: 'stream API error', message: facts.apiErrorText, errorCode: facts.apiErrorCode },
    { source: 'session transcript', message: transcript?.found ? transcript.text : null, errorCode: transcript?.found && typeof transcript.error === 'string' ? transcript.error : null },
  ];
  let selected = null;
  await log('🔍 Access-error cross-check:', { verbose: true });
  for (const source of sources) {
    const info = detectSubscriptionError({ ...source, tool: 'claude' });
    await log(`   ${source.source}: ${info ? `kind=${info.kind} code=${info.code || 'n/a'}` : 'no access-error evidence'}`, { verbose: true });
    if (!selected && info) selected = info;
  }
  const response = facts.debugApiError;
  await log(`   SDK response: http=${response?.status || 'n/a'} request_id=${response?.requestId || 'unknown'} transcript=${transcript?.found === true}`, { verbose: true });
  // A 403 says nothing about cancellation by itself. Prefer explicit provider
  // diagnostics, and do not replace a different, readable API error with a guess.
  if (!selected && response?.status === 403 && !facts.apiErrorText && !(transcript?.found && transcript.text)) {
    selected = detectSubscriptionError({
      tool: 'claude',
      errorCode: 'permission_error',
      apiErrorStatus: 403,
      message: `Claude API access denied (HTTP 403). The provider supplied no readable error reason.${response.requestId ? ` Request ID: ${response.requestId}` : ''}`,
    });
    // The HTTP status supplies this classification; no provider error code was emitted.
    selected.code = null;
  }
  return selected;
};

/** Resolve terminal evidence once, sharing the bounded transcript read. */
export const resolveClaudeFailureEvidence = async ({ lastMessage, limitReached, subscriptionError, exitCode, resultSuccessReceived, resultSummary, evidence, tempDir, sessionId, log }) => {
  lastMessage = selectClaudeFailureMessage({ lastMessage, exitCode, resultSuccessReceived, resultSummary });
  const usageLimit = !subscriptionError ? await resolveClaudeUsageLimit({ lastMessage, evidence, tempDir, sessionId, log }) : null;
  if (!subscriptionError && !resultSuccessReceived) {
    subscriptionError = await resolveClaudeAccessError({ lastMessage, evidence, transcript: usageLimit?.transcript, log });
    if (subscriptionError) {
      lastMessage = subscriptionError.message;
      limitReached = false;
      await log(`${SUBSCRIPTION_BLOCKED_MARKER} — ${subscriptionError.label}`);
    }
  }
  if (!subscriptionError && usageLimit?.isUsageLimit) [limitReached, lastMessage] = [true, usageLimit.message];
  return { lastMessage, limitReached, subscriptionError, crossCheckedLimit: usageLimit };
};
