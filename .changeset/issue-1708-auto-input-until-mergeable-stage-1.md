---
"@link-assistant/hive-mind": patch
---

Add the `--auto-input-until-mergeable`, `--stream-comments-to-input`, and
`--queue-comments-to-input` flags, plus a deep case study at
`docs/case-studies/issue-1708/` (issue #1708).

Stage 1 of issue #1708 introduces three new experimental flags. On
`--tool claude`, `--auto-input-until-mergeable` enables only the input
side of bidirectional mode — it implies
`--accept-incomming-comments-as-input` and defaults to
`--queue-comments-to-input` (defer comment delivery until the AI is
idle, so the model can finish the current step before being interrupted).
It does NOT enable `--interactive-mode` or
`--bidirectional-interactive-mode`, which would push tool output back as
PR comments — that is a separate feature with its own opt-in.
`--accept-incomming-comments-as-input` on its own keeps its existing
#817 behavior and now defaults to `--stream-comments-to-input` for
backwards compatibility. For non-Claude tools the validator emits the
standard "claude only" warning and leaves the session-restart loop
unchanged, so the default behavior of every existing flag
(`--auto-restart-until-mergeable`, `--auto-merge`, etc.) is preserved.

The case study at `docs/case-studies/issue-1708/` enumerates every
restart trigger today (`research/restart-input-matrix.md`), maps each
issue requirement to gaps in the current code, and stages the rest of
the implementation (issue/PR body+title polling, long-lived streaming
loop, resume-aware streaming, queue-mode handler wiring, smart restart
batching for non-Claude tools, and integration tests) as separate PRs
against this case study.
