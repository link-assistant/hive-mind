---
'@link-assistant/hive-mind': patch
---

A Claude, Codex or OpenCode run that stops on a usage limit is now reported as a usage limit, with its reset time, even when the tool does not say so in its last output line (#3570). Before, such a run failed with "Claude command failed with exit code 1" and was never resumed.

- **Claude:** on a failed exit, solve checks five sources, and any one of them is enough:
  - the `result` event or the last line;
  - the synthetic assistant `is_api_error_message`;
  - the session transcript tail (`isApiErrorMessage`);
  - the last `rate_limit_event` (`rejected` with `resetsAt`);
  - the `ANTHROPIC_LOG=debug` 429 headers (`anthropic-ratelimit-unified-status: rejected` with `anthropic-ratelimit-unified-reset`).

  An epoch reset gives the full date, for example `Oct 20, 2026, 11:00 AM` (UTC). A `rejected` event without `resetsAt` stays the #1924 throttle.
- **Codex:** on a non-zero exit that a signal did not cause, solve reads the last turn of the thread's rollout. A `token_count.rate_limits` window at 100% with `resets_at`, or an `error` event with `usage_limit_exceeded`, counts as a usage limit. A limit from an earlier turn does not. The Codex runner now also returns `limitTimezone`.
- **OpenCode:** a usage limit inside any `{"type":"error"}` record is found, not only one in the last stdout chunk.
- `ANTHROPIC_LOG=debug` dumps and base64 body lines are no longer used as the failure reason.
- In verbose mode, every source is logged with its verdict (`🔍 Usage-limit cross-check (issue #3570):`). solve warns `⚠️ Usage limit found only in: …` when the tool's own output missed the limit.
