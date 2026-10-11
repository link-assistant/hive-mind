---
'@link-assistant/hive-mind': patch
---

Recover killed Docker task sessions in place with `docker start` instead of a
`docker commit` snapshot. Task containers now look for a command handoff file
first, so the bot writes the recovery command into the stopped container with
`docker cp` and restarts the same container: nothing is copied, and the
writable layer and CPU/RAM limits are kept. Containers created before this
still use a snapshot, which now runs one at a time and only when the Docker
data root has room for twice the writable layer plus 10 GiB; otherwise the
recovery reports "waiting for disk" and falls back to a fresh launch. After a
snapshot-derived container starts, the stopped original is removed, and the
`start-command-resume/*` images are removed when the task finishes. The
Telegram recovery message shows these steps (docker start, waiting for disk,
queued, snapshotting N GiB).
