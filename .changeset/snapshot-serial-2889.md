---
'@link-assistant/hive-mind': patch
---

In-place kill recovery no longer fills the disk when several task containers are killed at once. Container snapshots (`docker commit` of the stopped container's writable layer) now run one at a time, and each starts only when the Docker data root has twice the writable layer plus 10 GiB free. While a recovery waits, its notice says so ("Waiting for N other container snapshots to finish first" or "Waiting for disk: X free, Y needed"); if the space does not appear within ten minutes, the recovery starts a fresh isolated session instead of snapshotting (issue #2889).
