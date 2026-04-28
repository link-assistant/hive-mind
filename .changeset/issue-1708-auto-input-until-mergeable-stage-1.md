---
"@link-assistant/hive-mind": patch
---

Add the `--auto-input-until-mergeable` flag and a deep case study at
`docs/case-studies/issue-1708/` (issue #1708).

Stage 1 of issue #1708 introduces the new experimental flag inert: it
parses, appears in `--help`, and on `--tool claude` composes with the
existing `--bidirectional-interactive-mode` (and therefore the three
sub-flags from issue #817), so users opting in get the mid-session
NDJSON streaming-input pipe that already exists today. For non-Claude
tools the validator emits the standard "claude only" warning and leaves
the session-restart loop unchanged, so the default behavior of every
existing flag (`--auto-restart-until-mergeable`, `--auto-merge`, etc.)
is preserved.

The case study at `docs/case-studies/issue-1708/` enumerates every
restart trigger today (`research/restart-input-matrix.md`), maps each
issue requirement to gaps in the current code, and stages the rest of
the implementation (issue/PR body+title polling, long-lived streaming
loop, resume-aware streaming, smart restart batching for non-Claude
tools, and integration tests) as separate PRs against this case study.
