---
'@link-assistant/hive-mind': patch
---

Fix CI/CD false negatives found in issue #2923: post-publish verification now waits up to 25 minutes for npm to expose a version (2.35.1 took 874s, more than the old 330s window), treats `E409 Cannot publish over previously staged version` as already published, and keeps its registry probes quiet unless `HIVE_MIND_PUBLISH_VERBOSE=true`. The release gate now also releases a version that reached npm without a GitHub release, so its Docker images and Helm chart are produced. The E2E matrix explains why it skipped, and the agent no longer logs "recovered" for an error that still fails the run. The `--verbose` leftover-process check no longer warns about the task-owned `formal-ai serve`, which Hive Mind keeps for later sessions and stops at exit.
