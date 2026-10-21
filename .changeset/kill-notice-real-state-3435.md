---
'@link-assistant/hive-mind': patch
---

A kill notice on GitHub shows the real state of the recovery (#3435):

- The notice says only what is known when it is posted: "Automatic recovery started", not "a new working session was started". If no pending note was posted, the notice gives the reason no recovery started.
- When a recovery attempt fails too (for example exit 127), its outcome is added to the same kill notice instead of being reported nowhere. If the notice cannot be edited, a short comment is posted.
- The exit line names its process: `1 (solve); the AI tool (claude) exited 137 (SIGKILL, cgroup OOM)`.
- When solve already posted its own comment about the killed process, the monitor does not post a second notice for the same event.
