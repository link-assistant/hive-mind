---
'@link-assistant/hive-mind': patch
---

Make disk admission safer by default: the disk usage queue gate now waits at 80%, the absolute free-space default is 10240 MB, and isolation defaults to Docker.
