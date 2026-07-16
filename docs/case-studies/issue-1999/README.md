# Case Study — Issue #1999

**Title:** No space used on finish of container
**Issue:** https://github.com/link-assistant/hive-mind/issues/1999
**Pull Request:** https://github.com/link-assistant/hive-mind/pull/2000
**Branch:** `issue-1999-8ce06377068e`

## Summary

Issue #1999 reports that the Telegram completion message for a Docker-isolated
`/solve` run showed the container filesystem size only at start, not at
completion. The attached screenshot proves the gap: the `Disk usage` section
contains `Container filesystem size: On start: 52 KB`, but no `On completion`
line.

The deeper requirement is broader than the screenshot:

- show full container / filesystem disk usage after the task finishes, including
  temp directories and software installed outside the cloned repository;
- print CPU, memory, and disk indicators at the start and end of `solve`;
- print the same indicators around AI restart iterations;
- have the Telegram bot log CPU, memory, and disk usage periodically from
  outside the task container;
- compile the collected issue/PR evidence and analysis in this folder.

## Evidence Collected

| File                                                                     | Purpose                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`issue.json`](./issue.json)                                             | Issue metadata and body captured with `gh issue view`.                    |
| [`issue-comments.json`](./issue-comments.json)                           | Issue comments, empty at capture time.                                    |
| [`pr-conversation-comments.json`](./pr-conversation-comments.json)       | PR conversation comments, empty at capture time.                          |
| [`pr-review-comments.json`](./pr-review-comments.json)                   | PR inline review comments, empty at capture time.                         |
| [`pr-reviews.json`](./pr-reviews.json)                                   | PR reviews, empty at capture time.                                        |
| [`assets/issue-1999-screenshot.png`](./assets/issue-1999-screenshot.png) | Screenshot from the issue showing the missing completion filesystem size. |

## Timeline

| Time (UTC)             | Event                                                      |
| ---------------------- | ---------------------------------------------------------- |
| `2026-06-29T18:02:10Z` | Issue #1999 opened by `konard`.                            |
| `2026-06-29T18:03:41Z` | Issue updated with the screenshot attachment.              |
| `2026-06-29T18:04:49Z` | Draft PR #2000 opened on branch `issue-1999-8ce06377068e`. |

There were no issue comments, PR conversation comments, PR inline comments, or
reviews when this case study was compiled.

## Existing Behavior

Two diagnostics already existed before this issue:

- `solve.disk-diagnostics.lib.mjs` writes repository-size markers after clone and
  after AI execution. These measure the working tree, not the whole container.
- `session-monitor.lib.mjs` appends Docker container filesystem size to the
  Telegram completion message when it can inspect the task container and read
  the Docker writable-layer size.

This explains the screenshot. The start size was captured while the Docker
container was still inspectable. The completion size depended on a later monitor
probe. If that probe returned `null`, the formatter had no fallback and therefore
printed only `On start`.

Docker's official CLI docs say `docker inspect --size` adds container size fields
and works for stopped containers, but that still assumes the container exists and
is inspectable when the monitor runs. The Engine API documents the same size
data as `SizeRw` / `SizeRootFs` when size information is requested.

## Root Cause

The monitor was relying on an outside-container Docker inspection after the task
had already reached a terminal state. That is fragile for detached automation:
the start-command lifecycle or cleanup policy can remove the container, hide it
behind an unavailable status record, or make the monitor unable to resolve the
container name by the time it builds the final Telegram message.

The repository-size markers were not enough to compensate because they only
measure `tempDir`. The issue explicitly asks for disk usage that includes
software, package caches, and temporary directories created outside the cloned
repository.

## Solution Applied

The fix adds a second diagnostics channel that is written by `solve` itself from
inside the task before the container exits:

- `src/solve.resource-diagnostics.lib.mjs` captures CPU load, CPU count, memory
  totals/available/process RSS, and full filesystem usage with `fs.statfsSync`.
- `src/solve.mjs` records resource snapshots at solve start, after clone, after
  AI execution, and just before `safeExit`.
- `src/solve.restart-shared.lib.mjs` records snapshots before and after each AI
  restart iteration.
- `src/session-monitor.lib.mjs` parses the `📈 [RESOURCES]` markers and uses the
  final solve snapshot as the Docker completion filesystem fallback when Docker
  inspection cannot produce `containerFilesystemAfterBytes`.
- `src/bot-lifecycle.lib.mjs` includes a compact CPU/memory/disk summary in each
  heartbeat log entry, so operators also get outside-container telemetry from
  the Telegram bot process.

The fallback is intentionally narrow: an explicit Docker completion size still
wins. The solve-log fallback is only used for Docker sessions when the completion
Docker size is missing.

Node's official `fs` documentation lists `fs.statfsSync(path[, options])` as the
sync filesystem statistics API. That gives the in-container measurement a stable
Node built-in instead of shelling out to `df`.

## Verification Plan

Automated tests added:

- `tests/test-issue-1999-resource-diagnostics.mjs` validates resource snapshot
  capture, marker round-tripping, best-final-marker selection, formatting, and
  heartbeat summary shape.
- `tests/test-issue-1999-session-monitor-disk-fallback.mjs` reproduces the
  screenshot-class failure: Docker start size exists, completion Docker inspect
  is missing, and the monitor must still render a container `On completion`
  size from the final solve resource marker.
- `tests/test-issue-1927-bot-lifecycle.mjs` was extended to assert that heartbeat
  entries carry resource telemetry and continue logging when resource capture
  fails.

Related regression tests to keep running:

- `tests/test-issue-1945-disk-diagnostics.mjs`
- `tests/test-issue-1945-session-monitor-integration.mjs`

## References

- Docker CLI `docker inspect --size`: https://docs.docker.com/reference/cli/docker/inspect/
- Docker Engine API container size fields: https://docs.docker.com/reference/api/engine/version/v1.43/
- Node.js `fs.statfsSync`: https://nodejs.org/api/fs.html
