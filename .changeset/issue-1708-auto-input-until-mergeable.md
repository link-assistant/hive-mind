---
'@link-assistant/hive-mind': minor
---

Add `--auto-input-until-mergeable` (issue #1708): a new experimental
mode that extends a single Claude session for as long as possible by
streaming PR/issue comments, CI/CD failures, uncommitted-changes
status, and PR/issue title/body updates as NDJSON `user` frames into
the live `claude --input-format stream-json` process — instead of
killing the process and restarting with the feedback prepended to a
fresh prompt.

What it ships:

- Three new flags in `src/solve.config.lib.mjs`, all defaulting to
  `false` and marked `[EXPERIMENTAL]`:
  - `--auto-input-until-mergeable` — top-level opt-in for the new
    behavior. Implies `--accept-incomming-comments-as-input` and
    defaults to `--queue-comments-to-input` so the AI can finish its
    current step before being interrupted.
  - `--stream-comments-to-input` — forward each comment immediately
    as it arrives. Default for `--accept-incomming-comments-as-input`
    on its own (preserves the existing #817 behavior).
  - `--queue-comments-to-input` — buffer comments while the AI is
    busy and flush them only on `result` events. Default delivery
    mode for `--auto-input-until-mergeable`. Mutually exclusive with
    `--stream-comments-to-input`; queue mode wins if both are set.

- Queue-vs-stream delivery wired into
  `src/bidirectional-interactive.lib.mjs#createBidirectionalHandler`:
  - New `deliveryMode` option (`'stream'` / `'queue'`) plus
    `markAiBusy()` / `markAiIdle()` lifecycle methods exposed on the
    handler.
  - In queue mode, comment frames and status frames are buffered in
    `pendingFrames` while busy and FIFO-flushed to stdin on the next
    `result` event. In stream mode, frames go to stdin immediately as
    today.

- Status streaming (only when `--auto-input-until-mergeable` is on)
  in `src/bidirectional-interactive.lib.mjs#checkForStatusChanges`:
  - New parallel poller emits one-shot NDJSON frames for: PR
    title/body changes, issue title/body changes (Issue #1708 G1),
    uncommitted local changes (`git status --porcelain`), and CI
    blockers (via `getMergeBlockers`).
  - Each change is keyed by a stable signature so the same failing
    check doesn't re-emit on every poll; failures in any sub-check
    are swallowed and logged so the poller never breaks the live
    Claude session.

- Stream parser in `src/claude.lib.mjs#executeClaudeCommand` now
  signals `markAiBusy()` on `assistant` / `tool_use` / `tool_result`
  events and `markAiIdle()` on `result` events, so queue-mode
  buffering tracks the actual AI lifecycle.

- `src/solve.auto-merge.lib.mjs#watchUntilMergeable` logs a
  "streaming-first" banner when `--auto-input-until-mergeable` was
  active, so it is clear the auto-restart loop is the fallback rather
  than the primary handler.

- For non-Claude tools, the validator continues to warn and disable
  all four flags — the existing #817 fallback path. The default
  behavior of every existing flag
  (`--auto-restart-until-mergeable`, `--auto-merge`, etc.) is
  preserved (R4: "must not break any existing features").

- Tests:
  `tests/test-auto-input-until-mergeable-1708.mjs` (59 assertions)
  and 11 new assertions in
  `tests/test-bidirectional-interactive.mjs` cover flag composition,
  queue-vs-stream routing, FIFO flushing on idle, busy-flag
  preservation across stream-mode writes, default-deliveryMode is
  stream, status-frame stamping with the right header per kind
  (`comment` / `ci` / `uncommitted` / `metadata`), and metadata
  diff/snapshot helpers.

The case study at `docs/case-studies/issue-1708/` is updated to
reflect that R1, R2 (Claude path), R3 (PR/issue title+body, CI,
uncommitted, comments), R4, R5, R6, plus G1, G5, G7 are addressed
here. Codex/Agent/OpenCode still degrade gracefully (no mid-session
NDJSON channel upstream) and use the existing `watchUntilMergeable`
loop as documented in G4.
