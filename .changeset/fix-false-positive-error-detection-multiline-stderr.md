---
'@link-assistant/hive-mind': patch
---

fix: prevent false positive error detection when multi-line stderr chunks contain JSON warnings (Issue #1354)

Previously, when Claude CLI emitted multiple JSON log lines in a single stderr chunk (newline-separated), the entire multi-line string was passed to `isStderrError()` as one unit. Since `JSON.parse()` would fail on two concatenated JSON objects, it fell through to keyword matching — finding words like `"failed"` inside warning messages — and incorrectly flagged a successful run as an error.

Additionally, `messageCount === 0 && toolUseCount === 0` could fire even after a 60-turn successful session, because the counter only checked for `data.type === 'message'` but Claude CLI emits outer events as `"assistant"` type.

Now the fix applies two targeted changes to `src/claude.lib.mjs`:

1. **Split multi-line stderr chunks by newline** and check each line individually with `isStderrError()`, so valid JSON warning lines are correctly parsed and not conflated with error patterns.

2. **Track `resultSuccessReceived`** when `data.type === 'result' && data.subtype === 'success'` is received, and add a `!resultSuccessReceived` guard to the false positive detection condition — ensuring a confirmed successful result prevents spurious error reporting.

Full case study analysis including timeline reconstruction, root cause analysis, and evidence in `docs/case-studies/issue-1354/`.
