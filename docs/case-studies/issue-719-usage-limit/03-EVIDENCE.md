#!/usr/bin/env markdown

# Evidence and Timeline

This document compiles concrete evidence, logs, and a reconstructed timeline for Issue #719: usage limit handling across tools (Claude, Codex, OpenCode).

- Issue: https://github.com/deep-assistant/hive-mind/issues/719
- Pull Request: https://github.com/deep-assistant/hive-mind/pull/722

## Timeline

- 2025-11-12 12:32 UTC — Issue opened with logs showing: "You've hit your usage limit. … try again at 12:16 PM." (source issue body)
- 2025-11-13 03:54 UTC — Run detects session usage limit in Claude output; command previously returned exit code 0. PR comments added usage-limit detection and formatted messaging in tools and PR comments.
- 2025-11-13 04:04 UTC — CI failure on branch `issue-719-a653aae7d4d5` due to argument alias: Unknown arguments: skip-claude-check, skipClaudeCheck (Run ID 19320129982).
- 2025-11-13 04:07–04:13 UTC — Fixes pushed; subsequent CI runs pass (Run IDs: 19320182040, 19320210206, 19320298099). Latest run queued for commit 7c17442.

## CI Failure Evidence (Fixed)

The following snippet from failed CI run (19320129982) shows the root cause that was subsequently fixed by mapping `--skip-claude-check` to the unified `--skip-tool-check` in both hive and solve.

```text
Error: Unknown arguments: skip-claude-check, skipClaudeCheck
```

Context excerpt:

```text
… Test hive dry-run with solve integration …
Error: Unknown arguments: skip-claude-check, skipClaudeCheck
⚠️ Could not verify flag propagation in dry-run mode (may be due to no issues found)
Testing solve.mjs with --dry-run and --skip-claude-check flags…
…
```

Fixed by commits (examples from PR comments):
- Map `--skip-claude-check` alias to `--skip-tool-check` in solve and hive; propagate to child solve invocation.

## Usage Limit Evidence (From Issue Logs)

User-provided logs demonstrate Anthropic usage limit pattern including reset time:

```json
{"type":"error","message":"You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}
{"type":"turn.failed","error":{"message":"You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}}
```

Implemented handling across tools now:
- Detects usage limit via `detectUsageLimit(message)` with reset time extraction.
- Returns `{ success: false, limitReached: true, limitResetTime }` from tool executors.
- Captures `global.limitResetTime` in `solve.mjs` for auto-continue and cleanup decisions.
- `attachLogToGitHub()` in `src/github.lib.mjs` formats a dedicated "Usage Limit Reached" PR/issue comment including reset time, session ID, resume instructions, and log details when `--attach-logs` is used.

## Root Causes

- Usage limit errors were previously surfaced as successful outcomes in some paths due to exit code handling and lack of special formatting.
- Reset time from tool output was not consistently propagated to the outer layers responsible for auto-continue and PR comments.
- CI regression: argument alias `--skip-claude-check` not recognized after refactors; CI tests validated the flag propagation and failed until alias was added back.

## Resolution Summary

- Added `src/usage-limit.lib.mjs` implementing robust detection and reset time extraction.
- Integrated usage-limit handling in `src/claude.lib.mjs`, `src/codex.lib.mjs`, and `src/opencode.lib.mjs` with clear console messages and resume hints.
- Ensured `solve.mjs` captures `toolResult.limitResetTime` to enable auto-continue and comment messaging.
- Enhanced `src/github.lib.mjs` to publish a dedicated, readable usage-limit comment with optional attached logs.
- Restored CLI alias support for `--skip-claude-check` in both `solve` and `hive` to keep CI scenarios passing and UX stable.

## Verification

- CI runs after fixes: success for commits `97aea4d`, `dd81ea9`, `f0f83ec`; latest run for `7c17442` queued at the time of writing.
- Local linting shows no errors (warnings only). Integration tests are performed in CI workflows.

## Next Steps (Optional)

- Add minimal unit tests for `usage-limit.lib.mjs` (regex/time extraction) when a test harness is introduced.
- Extend examples/experiments to simulate usage-limit scenarios for smoke validation.

