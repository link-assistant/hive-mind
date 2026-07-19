---
'@link-assistant/hive-mind': patch
---

Fix false positives and false negatives in CI/CD (issue #2082). Release and Helm scripts now fail on non-zero exit codes instead of silently continuing, npm publish verification retries registry propagation without republishing, version bumps retry a rejected push on top of the new remote HEAD, shell test assertions fail the build, every workflow job declares a timeout, and jobs use `!cancelled()` so concurrency cancellation is respected. Releases on main now queue rather than cancel, so a run cannot be interrupted between publishing to npm and pushing the version bump.
