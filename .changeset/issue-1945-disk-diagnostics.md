---
'@link-assistant/hive-mind': patch
---

feat(solve): log working-tree size before/after the AI agent and warn on Telegram when disk usage exceeds 5 GB (#1945)

`/solve` now records the size of its temporary working tree at two checkpoints:
after the repository is cloned (before the AI agent starts) and after the AI
working session ends. Both checkpoints emit a structured `📊 [DISK]` marker into
the captured solve log, so the cloned-repo size, the AI-induced delta, and the
final total are visible in `tail -f`-style debugging.

The session monitor parses those markers from the captured log and appends a
`💾 Disk usage` block to the Telegram completion message. The block raises a
warning when the cloned repository exceeds 5 GB, when the working tree grew by
more than 5 GB during the run, or when the total disk usage for the task
exceeds 5 GB — exactly the three conditions called out in the issue.

Sizing uses `du -sb` (byte-accurate on Linux), falls back to `du -sk` on BSD/
macOS, and finally to `fs.statSync` for single-file targets — no new runtime
dependency. The threshold is 5 GiB and uses a strict `>` comparison, so a tree
that lands at exactly 5 GiB does not warn.
