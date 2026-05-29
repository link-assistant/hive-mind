---
'@link-assistant/hive-mind': patch
---

feat(telegram): list executed issues/PRs as clickable links in /solve_queue, add /queue alias (#1837)

The `/solve_queue` detailed status previously showed only per-tool counts and a
final `Completed: N, Failed: M` line, so a stuck or running task could not be
opened from the message. It now lists each processing (`▶️`), pending (`•`),
recently completed (`✅`), and failed (`❌`, with the error reason) item as a
clickable `[owner/repo#number](url)` link, capped per section
(`HIVE_MIND_MAX_DISPLAY_ITEMS_PER_QUEUE`, default 5) with a localized
`... and N more` line to stay under Telegram's 4096-character limit.

Also adds `/queue` as a shorter alias for `/solve_queue` (both the entity-based
command regex and the text-based fallback handler), and documents the work in
`docs/case-studies/issue-1837`.
