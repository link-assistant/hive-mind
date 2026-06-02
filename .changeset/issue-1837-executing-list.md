---
'@link-assistant/hive-mind': patch
---

fix(telegram): list currently-executing tasks in `/solve_queue` (`/queue`), not just count them (#1837)

After the original #1837 work added clickable lists, the detailed status still
showed only a `processing: N` **count** for in-flight work — the executing task
itself was never rendered as a clickable link, which is exactly the case the
issue cares most about ("search tasks that are stuck or yet executing").

Root cause: the processing **count** comes from the external snapshot
(`max(pgrep, tracked-isolation-session count)`), but the processing **list**
iterated the queue's own in-memory `processing` Map. `executeItem()` deletes an
item from that Map the moment the work is dispatched to a detached
screen/isolation session, so while a task is actually executing the Map is empty
— count says `1`, list shows nothing.

The fix sources the executing items from the same place the count comes from. A
new `getRunningSessionItems()` in `session-monitor.lib.mjs` returns the
currently-running detached sessions (with their GitHub `url`, `tool`, `status`,
`startTime`), reusing the existing isolation `$ --status` / non-isolation
screen-liveness checks. New helpers `collectExecutingItems` and
`formatQueueProcessingItems` merge those sessions with the in-memory Map (deduped
by normalized GitHub URL, filtered by tool) and render them as the `▶️
[owner/repo#n](url) (status, duration)` lines, capped with `... and N more`.
`formatDetailedStatus()` now lists executing tasks from this merged source.

Adds `tests/test-issue-1837-executing-list.mjs` plus new `solve-queue.test.mjs`
cases, and documents the root cause and fix in `docs/case-studies/issue-1837`.
