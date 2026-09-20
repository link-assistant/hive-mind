/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2101. Codex can exhaust its own WebSocket and
 * HTTPS attempts with a generic "high demand" message that contains neither an
 * HTTP status nor the word "overloaded". Hive Mind must still resume the
 * preserved Codex thread instead of treating the transient outage as fatal.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { criticalErrorRecovery } from '../src/config.lib.mjs';
import { classifyRetryableError } from '../src/tool-retry.lib.mjs';

const incidentMessages = ["Falling back from WebSockets to HTTPS transport. We're currently experiencing high demand, which may cause temporary errors.", "We're currently experiencing high demand, which may cause temporary errors.", 'Falling back from WebSockets to HTTPS transport. unexpected status 503 Service Unavailable: {"error":"Too many concurrent requests","detail":{"code":"throttled","source":"concurrency_limit"}}'];

for (const message of incidentMessages) {
  const classification = classifyRetryableError(message);
  assert.equal(classification.isRetryable, true, `expected transient Codex failure to be retryable: ${message}`);
  assert.equal(classification.isCapacity, false, 'service-wide demand must retry the selected model, not switch models');
}

assert.equal(criticalErrorRecovery.autoCommitUncommittedChanges, true, 'catastrophic-failure recovery must preserve uncommitted work by default');

const solveSource = fs.readFileSync(new URL('../src/solve.mjs', import.meta.url), 'utf8');
const failureBranch = solveSource.slice(solveSource.indexOf('if (!success && !shouldSkipFailureExitForAutoLimitContinue)'), solveSource.indexOf('await safeExit(1, toolFailureMessage)'));
assert(failureBranch.indexOf('commitUncommittedChangesOnCriticalError') < failureBranch.indexOf('attachLogToGitHub'), 'emergency commit must run before the potentially slow/failing log upload');

console.log('✅ issue #2101: Codex high-demand failures are resumable and emergency commits remain enabled');
