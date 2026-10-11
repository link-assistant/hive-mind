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

The post-result close timeout now follows Claude Code's background tasks. In
every reported run, print mode was still waiting for a CI or test waiter task
when the 30-second timer stopped it. While background tasks run, the solver now
waits up to Claude Code's own print-mode wait ceiling. It pauses the timer when
a finished task starts another turn, and logs which tasks it is waiting for. A
CLI with nothing pending is still stopped after 30 seconds.

Docker images install Bun 1.4.3 and start-command 0.37.0; prettier is 3.9.10.
command-stream is pinned to 2.1.0 for the dependency freshness gate.
