---
'@link-assistant/hive-mind': patch
---

Fix issue #3000: container listings no longer make dockerd walk every container's writable layer. `/cleanup` and the docker image reclaim plan used `docker ps --format '{{json .}}'`, which makes the docker CLI request `.Size`. That was slow (2.5 s instead of 0.35 s on production), and on the containerd image store it failed with `snapshotter.Usage failed … no such file or directory` whenever a task deleted a file mid-walk. Both now name the fields they read. When `docker ps` fails, `/cleanup` reports the daemon error instead of "(none detected)", and the reclaim plan returns no plan instead of treating every image as unused.
