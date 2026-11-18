---
'@link-assistant/hive-mind': patch
---

A Codex turn that degenerates, runs out of output tokens or runs too long no longer ends the run with nine hours of work left uncommitted. Account identifiers no longer reach published logs (issue #4079).

- **Degenerate output.** A run of 200 identical or filler lines (`.`, blank) in text the model writes stops the turn, and the session is resumed with a continuation prompt. This covers stdout items and the `codex.tool_result` arguments on stderr. Set `HIVE_MIND_CODEX_DEGENERATE_LINE_LIMIT` to change the limit, or `0` to disable it.
- **`max_output_tokens`.** `Incomplete response returned, reason: max_output_tokens` now resumes the same Codex session from the current working tree instead of failing the run, up to `HIVE_MIND_CODEX_MAX_TRUNCATION_RESUMES` (3) times per run.
- **Long turns.** A single turn is split, and the session resumed, after `HIVE_MIND_CODEX_MAX_TURN_MINUTES` (240) or `HIVE_MIND_CODEX_MAX_TURN_INPUT_TOKENS` (100M; needs `--verbose`), up to `HIVE_MIND_CODEX_MAX_TURN_SPLITS` (20) times per run. A turn is never stopped while a command or file change is running.
- **Codex stderr.** A multi-line Codex telemetry record (for example, a tool call's arguments) now goes to the trace file with its header instead of into the log. Repeated lines collapse into `… previous line repeated N more times`.
- **Account identifiers.** `user.email`, `user.account_id` and similar values are redacted to `<redacted>` in Codex stderr, in the trace file and in every log sanitized for publishing.
- **Recovery branch.** On a continue run, work a failed run preserved on `recovery/<branch>` is restored to the working tree if the PR branch has not moved. Otherwise the session is told where the work is. The failure comment now names the recovery branch.
