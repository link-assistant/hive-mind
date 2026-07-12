---
'@link-assistant/hive-mind': patch
---

Recognize an operator-initiated `/stop` as "🛑 Work session stopped by user" instead of "killed — out of memory or forced kill (SIGKILL)" (issue #2052). The Telegram `/stop <uuid>` flow now records the stop via `markSessionStopRequested` before forwarding CTRL+C, so the resulting SIGTERM/SIGKILL exit (143/137) is reported as an intentional user stop. Adds `--verbose` interrupt timing traces (auto-commit vs log-upload) to make the `docker stop` grace-period race behind "no log uploaded on stop" measurable, plus a case study under `docs/case-studies/issue-2052`.
