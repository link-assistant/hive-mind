---
'@link-assistant/hive-mind': patch
---

Bound Docker writable-layer inspection during isolated task startup, and preserve full diagnostics when a Docker-isolated task dies during startup: the start gate now narrates its wait, outcome and hand-off, the DinD daemon log is streamed into the task log by default (`HIVE_MIND_DIND_DAEMON_LOG=0` opts out), and the container is snapshotted to the host (`docker inspect`, `docker logs`, `dockerd.log`) before it is removed, with the decoded signal and `OOMKilled` state quoted in the completion notification.
