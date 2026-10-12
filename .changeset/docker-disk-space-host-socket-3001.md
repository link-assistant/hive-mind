---
'@link-assistant/hive-mind': patch
---

Fix the Docker disk-space preflight (#3001) when the bot uses the host Docker socket from a container. The daemon's data root is now measured through the daemon itself: `df` runs in a throwaway container of an already-present image, with `--pull never`, no network and a read-only bind mount. `/var/lib/containerd` is measured too with the containerd image store (the Docker 29 default). When the check cannot run, the preflight logs a warning with the real reason instead of a verbose "could not parse df output". The same root cause, command-stream's `$` resolving rather than throwing on a non-zero exit, is fixed across the codebase: a missing image or tmux session was reported as present, rate-limited or transient `gh` calls were never retried, a missing `bun` still switched Claude's runtime, and failed `gh` progress updates were logged as success.
