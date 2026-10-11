---
'@link-assistant/hive-mind': patch
---

Stop solve's log from contradicting itself (#2845). "Auto-merge mode enabled" is
printed only with --auto-merge; the default auto-restart-until-mergeable mode
says it will not merge. A pull request the run-end restore will mark ready is
reported as "kept as draft until run end" instead of "stays a draft". A failed
Claude session prints the "💡 To continue this session" block once instead of
three times: claude.lib.mjs no longer prints it twice, and solve, which prints
its own block with the solve --resume command, asks claude.lib not to print one.

Dependencies refreshed for the freshness gate: Box 2.10.4 (Docker images; the dind image now enables live restore for its nested Docker daemon), lino-objects-codec 0.9.2, and the use-m pin command-stream 2.3.0.
