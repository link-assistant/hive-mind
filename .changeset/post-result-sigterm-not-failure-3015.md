---
'@link-assistant/hive-mind': patch
---

Stop reporting successful Claude sessions as "Solution Draft Failed" when the
CLI does not exit after its result. The solver stops such a CLI itself after
30 seconds (Issue #1280), and command-stream 0.12+ reports that as an exit chunk
with code 143. That code was counted as a failure, and the AI's own work summary
was published as the error ("CLAUDE execution failed with I fixed the four…"),
turning a ready PR back into a draft. Both exit paths now share one rule. A tool's
work summary is never published as a failure reason for any tool, and the
SIGKILL follow-up is sent while the CLI's process group is still alive.

Docker images install Bun 1.4.3 and start-command 0.37.0; prettier is 3.9.10.
