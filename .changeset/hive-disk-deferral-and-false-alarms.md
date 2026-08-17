---
'@link-assistant/hive-mind': patch
---

Stop reporting a host that ran out of disk space as failed tasks: `/hive` now checks free space before each task, requeues the task as a deferral while peers are still running, reclaims only temp directories that no process is using, and exits with `EX_TEMPFAIL` (75) when work remains blocked. Also fix the false alarms around it — `getLogFile is not a function` in the restart paths, the bogus `.gitkeep` cleanup warning, benign in-session tool results and defaulted source cleanup being reported as problems, merged solution drafts being summarized as `(no PR found)`, and `--auto-cleanup` being a no-op at one call site.
