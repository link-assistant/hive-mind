/**
 * @hive-mind-test-suite default
 *
 * Issue #3215: Codex usage-limit detection read only the preferred error
 * message (`turn.failed` first). When `turn.failed` is generic and the limit
 * with its reset time arrived in an earlier stream `error` event, the run was
 * treated as an ordinary failure instead of a limit to wait for.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCodexUsageLimitMessage, getCodexErrorEventSummary } from '../src/codex-health.lib.mjs';
import { detectUsageLimit } from '../src/usage-limit.lib.mjs';

const LIMIT = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Jun 11th, 2026 12:27 AM.";

test('a limit in a stream error is found when turn.failed is generic', () => {
  const summary = getCodexErrorEventSummary({ eventCounts: {}, streamErrors: [{ message: LIMIT }], turnFailures: [{ message: 'stream disconnected before completion' }], itemErrors: [] });
  assert.equal(summary.message, 'stream disconnected before completion', 'turn.failed stays the reported failure');
  assert.equal(detectUsageLimit(summary.message).isUsageLimit, false, 'the old source missed the limit');
  assert.equal(findCodexUsageLimitMessage(summary, detectUsageLimit), LIMIT);
});

test('turn.failed is still preferred, and tool output is never read as a limit', () => {
  const both = getCodexErrorEventSummary({ eventCounts: {}, streamErrors: [{ message: 'Weekly limit reached' }], turnFailures: [{ message: LIMIT }], itemErrors: [] });
  assert.equal(findCodexUsageLimitMessage(both, detectUsageLimit), LIMIT);
  const itemOnly = getCodexErrorEventSummary({ eventCounts: {}, streamErrors: [], turnFailures: [{ message: 'command failed' }], itemErrors: [{ message: `curl printed: ${LIMIT}` }] });
  assert.equal(findCodexUsageLimitMessage(itemOnly, detectUsageLimit), null);
  assert.equal(findCodexUsageLimitMessage(null, detectUsageLimit), null);
});
