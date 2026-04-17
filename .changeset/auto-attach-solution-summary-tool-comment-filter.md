---
'@link-assistant/hive-mind': patch
---

Fix `--auto-attach-solution-summary` falsely detecting solve.mjs's own session bookkeeping comments ("AI Work Session Started", "Solution Draft Log", "Auto-restart", "Ready to merge", etc.) as AI-authored comments and therefore skipping the solution summary attachment even when the AI session produced no comments of its own. The check now filters out tool-generated comments using a shared marker list and logs which comments were skipped when `--verbose` is enabled. See issue #1625.
