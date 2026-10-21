---
'@link-assistant/hive-mind': patch
---

A task container killed by a Docker daemon restart is no longer reported as out of memory (issue #2892). Docker's `State.OOMKilled` flag is sticky: an earlier child-process OOM kill the container survived keeps it set. The session monitor now uses start-command's attributed exit reason before that flag. It also detects the restart from the log evidence, the docker.service journal, the dockerd start time, or the bot's own container having been killed in the same seconds. Such a session is reported as "killed by Docker daemon restart" in the PR notice, the kill diagnostics and Telegram, and kill recovery still runs.
