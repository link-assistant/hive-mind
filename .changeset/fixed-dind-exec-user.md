---
"@link-assistant/hive-mind": patch
---

Bump the Docker-in-Docker base image to `konard/box-dind:2.1.4` so `docker exec` sessions default to the `box` user with `/home/box` while dockerd still starts correctly.
