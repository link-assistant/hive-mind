---
'@link-assistant/hive-mind': patch
---

Keep Claude background work enabled and raise print mode's background-task wait ceiling to 4x Claude Code's default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=2400000`). When the ceiling still cancels work, recognise the sweep exactly, including local Bash tasks killed at exit, and silently resume the same session up to 5 times (`HIVE_MIND_CLAUDE_INCOMPLETE_TURN_MAX_RESUMES`) with a prompt that names the timeout and the cancelled tasks. Stop subagent cancellations and errors from becoming false "user rejected tool use" failures. Resume failed sessions affected by child OOM events, and report actual recovery outcomes.

Never lose a failure log silently, and report recovered work truthfully:

- Failed log uploads (for example `RPC failed; HTTP 408` on a large log) are retried and then re-uploaded as complete line-aligned parts. If they still fail, the pull request gets a `Log Upload Failed` comment with the reason and the log's location.
- The stop comment says whether the log was attached.
- A failed AI session inside `--auto-restart-until-mergeable` or `--watch` makes `solve` exit 1 instead of 0.
- A session that is resumed after a container OOM event now reads "🔄 Work session still in progress" until the recovery session ends. It keeps its original `📊 Session` id and total duration.
- The kill notice is posted on the pull request the session was started on.
- `⚠️ Formatting error detected` no longer appears for `message is not modified`, other non-formatting Telegram errors, or `/queue` links with `_`.
