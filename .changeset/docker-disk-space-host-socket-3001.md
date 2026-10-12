---
'@link-assistant/hive-mind': patch
---

Fix the Docker disk-space preflight (#3001) when the bot uses the host Docker socket from a container. The daemon's data root is now measured through the daemon itself: `df` runs in a throwaway container of an already-present image, with `--pull never`, no network and a read-only bind mount. `/var/lib/containerd` is measured too with the containerd image store (the Docker 29 default). When the check cannot run, the preflight logs a warning with the real reason instead of a verbose "could not parse df output". The same root cause, command-stream's `$` resolving rather than throwing on a non-zero exit, is fixed across the codebase: a missing image or tmux session was reported as present, rate-limited or transient `gh` calls were never retried, a missing `bun` still switched Claude's runtime, and failed `gh` progress updates were logged as success.

Refresh the pins the dependency-freshness gate flagged while this PR was open: Box base images 2.10.3 -> 2.10.4, command-stream 2.1.0 -> 2.3.0 (it still resolves with `{ code }` on a non-zero exit, see `experiments/issue-3001/command-stream-2.3.0-nonzero-exit.mjs`), and lino-objects-codec ^0.9.1 -> ^0.9.2.
