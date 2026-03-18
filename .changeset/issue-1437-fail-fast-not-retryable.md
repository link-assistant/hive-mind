---
'@link-assistant/hive-mind': patch
---

Fail fast when API signals x-should-retry: false and retries make no progress (Issue #1437). Increase minimum retry delay to 2 minutes.

When the Anthropic API returns HTTP 500 with `x-should-retry: false` AND subsequent retries immediately fail with `num_turns <= 1`, the outer retry loop now exits early instead of waiting through up to 10 retries with exponential backoff. This prevents stuck sessions where recovery is impossible.

Two new signals are tracked: (1) `apiMarkedNotRetryable` — set when `ANTHROPIC_LOG=debug` stderr contains `"error; not retryable"` or `x-should-retry: false`; (2) `resultNumTurns` — captured from the result event to detect sessions that failed immediately on resume. If both conditions are met after `HIVE_MIND_MAX_NOT_RETRYABLE_ATTEMPTS` (default: 5) retry attempts, the loop fails fast with a clear error message instead of continuing indefinitely.

The minimum retry delay for transient API errors (Overloaded, 503, Internal Server Error) is increased from 1 minute to 2 minutes (`HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS`), giving the API more time to recover between retries.
