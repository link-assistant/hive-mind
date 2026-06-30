# Case Study - Issue #2001

**Title:** Incorrect calculation of disk space usage
**Issue:** https://github.com/link-assistant/hive-mind/issues/2001
**Pull Request:** https://github.com/link-assistant/hive-mind/pull/2002
**Related regression:** https://github.com/link-assistant/hive-mind/pull/2000

## Summary

Issue #2001 reports that the disk-usage block added by PR #2000 can show the
parent Hive Mind deployment filesystem usage as if it were a single task's disk
usage. The screenshot in this folder shows a Docker-isolated task whose
repository was only 10 MB at clone time and 12 MB at completion, while the
Telegram completion message reported a container filesystem size of 54.8 GB at
start and 55.2 GB at completion, then warned that task usage exceeded 5 GB.

That warning was misleading. The code used solve-log `statfs('/')` resource
markers as a fallback when Docker could not provide a completion writable-layer
size. `statfs('/')` describes the mounted filesystem that contains `/`; it does
not describe the Docker task container's writable layer. In Docker isolation,
the task-scoped measurement is Docker's writable-layer size (`SizeRw`), sampled
with `docker inspect --size`.

## Evidence Collected

| File                                 | Purpose                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `issue-2001.json`                    | Issue metadata and full issue body.                                       |
| `issue-2001-comments.json`           | Issue comments. Empty at capture time.                                    |
| `assets/issue-2001-screenshot.png`   | Screenshot attached to the issue showing the incorrect 54+ GB task usage. |
| `pr-2000.json`                       | Metadata for the PR that introduced the regression.                       |
| `pr-2000.diff`                       | Full diff for PR #2000.                                                   |
| `pr-2000-conversation-comments.json` | Conversation comments for PR #2000. Empty at capture time.                |
| `pr-2000-review-comments.json`       | Inline review comments for PR #2000. Empty at capture time.               |
| `pr-2000-reviews.json`               | Reviews for PR #2000. Empty at capture time.                              |
| `pr-2002.json`                       | Metadata for this solution PR.                                            |
| `pr-2002-conversation-comments.json` | Conversation comments for PR #2002 at initial capture time.               |
| `pr-2002-review-comments.json`       | Inline review comments for PR #2002 at initial capture time.              |
| `pr-2002-reviews.json`               | Reviews for PR #2002 at initial capture time.                             |

## Timeline

| Time (UTC)           | Event                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- |
| 2026-06-29T18:04:49Z | PR #2000 opened to add solve resource diagnostics and disk-usage fallback behavior. |
| 2026-06-29T20:05:22Z | PR #2000 merged.                                                                    |
| 2026-06-30T22:05:59Z | Issue #2001 opened with a screenshot of the incorrect 54+ GB per-task disk usage.   |
| 2026-06-30T22:07:09Z | Draft PR #2002 opened for this fix.                                                 |

## Requirements

- Calculate disk usage for the executing task, not the full root Hive Mind
  deployment/container.
- Keep the disk-usage block useful for Docker-isolated sessions.
- Preserve the issue data and analysis under `docs/case-studies/issue-2001`.
- Reconstruct the timeline, requirements, root cause, and solution plan.
- Check related implementations and external references before fixing.
- Add regression coverage so the incorrect 54+ GB fallback cannot return.
- Apply the fix consistently across the monitor, durable session state, and
  disk-diagnostics tests.

## External References

- Docker CLI `docker inspect --size` documents size information for containers:
  https://docs.docker.com/reference/cli/docker/inspect/
- Docker Engine API exposes container size fields such as writable-layer size:
  https://docs.docker.com/reference/api/engine/
- Node.js `fs.statfsSync(path)` returns filesystem statistics for a path:
  https://nodejs.org/api/fs.html#fsstatfssyncpath-options

## Root Cause

PR #2000 added `solve.resource-diagnostics.lib.mjs`, which writes CPU, memory,
and disk markers to the captured solve log. The disk part uses
`fs.statfsSync('/')` and records `diskUsedBytes = totalBytes - freeBytes`.

That value is valid as a host/container resource diagnostic, but it is the wrong
semantic value for per-task disk usage. When the Telegram session monitor could
not inspect the Docker task container at completion time, it parsed the final
`📈 [RESOURCES]` marker and used `disk.usedBytes` as
`containerFilesystemAfterBytes`. For Docker deployments, that made the final
message report the parent filesystem's current occupancy as the task's
container filesystem size.

The repository-size markers were still correct, but they only measure the cloned
working tree. The Docker task container size must come from Docker's view of the
task container writable layer, not from `statfs('/')`.

## Solution

The fix keeps two diagnostics channels separate:

- Resource snapshots remain useful for CPU, memory, and filesystem-capacity
  debugging, but they are no longer used as Docker task filesystem-size
  fallbacks.
- Docker task usage comes from `docker inspect --size` / `.SizeRw`.
- While a Docker-isolated session is still running, the monitor samples the task
  container writable-layer size and stores it as
  `containerFilesystemLastBytes`.
- On completion, the monitor tries a fresh Docker writable-layer size. If that
  is unavailable, it falls back only to the last stored Docker writable-layer
  sample, never to `statfs('/')`.
- The durable session store now persists the last Docker filesystem sample and
  observation timestamp so a bot restart does not discard the last valid
  task-scoped measurement.

No external project issue is needed. The behavior is caused by Hive Mind's
fallback logic, not by Docker or Node.

## Verification

Automated tests added or updated:

- `tests/test-issue-2001-docker-disk-usage.mjs` reproduces the screenshot-class
  failure and verifies that `54.8 GB` / `55.2 GB` resource markers are not used
  as Docker task usage.
- The same test drives `monitorSessions()` through a running pass and a terminal
  pass, proving the final message can fall back to the last Docker writable-layer
  sample when a fresh completion inspect is unavailable.
- `tests/test-issue-1999-session-monitor-disk-fallback.mjs` now asserts that
  explicit Docker completion sizes still win, but `statfs('/')` resource markers
  are not accepted as the fallback.
- `tests/test-issue-1927-session-store.mjs` verifies the new persisted last
  Docker filesystem sample fields.

Relevant local checks:

- `node tests/test-issue-2001-docker-disk-usage.mjs`
- `node tests/test-issue-1999-session-monitor-disk-fallback.mjs`
- `node tests/test-issue-1927-session-store.mjs`
- `node tests/test-issue-1945-session-monitor-integration.mjs`
- `node tests/test-issue-1945-disk-diagnostics.mjs`
