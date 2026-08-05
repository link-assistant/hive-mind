#!/usr/bin/env node

/**
 * Issue #2141 — reproduce "AGENT execution failed with Agent reported error: [object Object]"
 * and show the same input after the fix.
 *
 * Run: node experiments/issue-2141/reproduce-object-object.mjs
 *
 * The input is the record shape `@link-assistant/agent` 0.25.5 writes for an
 * error (`outputJsonEvent('error', { error: props.error })` in src/cli/cmd/run.ts,
 * where `props.error` is `NamedError.toObject()` = `{name, data}`).
 */

import { extractAgentErrorText } from '../../src/agent.lib.mjs';
import { formatToolExecutionFailure } from '../../src/lib.mjs';

const raw = JSON.stringify({
  type: 'error',
  timestamp: 1785000000000,
  sessionID: 'ses_2141',
  error: { name: 'RetryTimeoutExceededError', data: { message: 'Retry timeout exceeded after 604800s' } },
});
const data = JSON.parse(raw);

// ── before the fix (src/agent.lib.mjs:671 and :773 as of v2.11.11) ───────────
const before = data.message || data.error || raw.substring(0, 100);
const beforeMessage = `Agent reported error: ${before}`;
// What v2.11.11 published: the message was appended verbatim, with no guard.
const beforeReason = `AGENT execution failed with ${beforeMessage}`;
// What the guard added in this PR would publish for the same polluted message.
const beforeReasonGuarded = formatToolExecutionFailure({ tool: 'agent', toolResult: { errorInfo: { message: beforeMessage } } });

console.log('BEFORE');
console.log('  errorInfo.message :', beforeMessage);
console.log('  published reason  :', beforeReason, '  ← issue #2141');
console.log('  with guard only   :', beforeReasonGuarded, '  ← honest, but still no diagnosis');

// ── after the fix ────────────────────────────────────────────────────────────
const after = extractAgentErrorText(data, raw);
const afterMessage = `Agent reported error: ${after}`;
const afterReason = formatToolExecutionFailure({ tool: 'agent', toolResult: { errorInfo: { message: afterMessage } } });

console.log('AFTER');
console.log('  errorInfo.message :', afterMessage);
console.log('  published reason  :', afterReason);

if (beforeMessage.includes('[object Object]') && !afterMessage.includes('[object Object]')) {
  console.log('\n✅ Reproduced the defect and confirmed the fix.');
  process.exit(0);
}

console.error('\n❌ Unexpected: the defect did not reproduce.');
process.exit(1);
