/** @hive-mind-test-suite default */
/**
 * Issue #4029: successful arm64 native Codex builds take 103-110 minutes
 * (dev/log/issues/4029/pulls/4030/native-codex-build-durations.txt). With a
 * 120-minute job timeout a slightly slower runner would cancel a healthy build
 * and fail the release (a false negative). The timeout keeps at least a
 * 30-minute margin over the slowest observed build.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const SLOWEST_OBSERVED_MINUTES = 110;
const MARGIN_MINUTES = 30;

test('native Codex build timeout leaves a margin over the slowest observed build', () => {
  const text = readFileSync(new URL('../.github/workflows/native-codex-build.yml', import.meta.url), 'utf8');
  const build = /^ {2}build:\n([\s\S]*?)(?=^ {2}\S|(?![\s\S]))/mu.exec(text)?.[1] ?? '';
  const timeout = Number(/^ {4}timeout-minutes: (\d+)$/mu.exec(build)?.[1]);
  assert.ok(Number.isFinite(timeout), 'build job has no timeout-minutes');
  assert.ok(timeout >= SLOWEST_OBSERVED_MINUTES + MARGIN_MINUTES, `timeout-minutes ${timeout} < ${SLOWEST_OBSERVED_MINUTES} + ${MARGIN_MINUTES}`);
});
