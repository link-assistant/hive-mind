---
'@link-assistant/hive-mind': patch
---

Never lose a failure log silently, and report recovered work truthfully:

- Failed log uploads (for example `RPC failed; HTTP 408` on a large log) are retried and then re-uploaded as complete line-aligned parts. If they still fail, the pull request gets a `Log Upload Failed` comment with the reason and the log's location.
- The stop comment says whether the log was attached.
- A failed AI session inside `--auto-restart-until-mergeable` or `--watch` makes `solve` exit 1 instead of 0.
- A session that is resumed after a container OOM event now reads "🔄 Work session still in progress" until the recovery session ends. It keeps its original `📊 Session` id and total duration.
- The kill notice is posted on the pull request the session was started on.
- `⚠️ Formatting error detected` no longer appears for `message is not modified`, other non-formatting Telegram errors, or `/queue` links with `_`.
