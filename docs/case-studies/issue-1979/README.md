# Issue 1979 Case Study: Docker Task Container Reaping

## Scope

Issue: [link-assistant/hive-mind#1979](https://github.com/link-assistant/hive-mind/issues/1979)

PR: [link-assistant/hive-mind#1985](https://github.com/link-assistant/hive-mind/pull/1985)

This case study covers Docker-isolated Telegram task sessions launched through
`$ --isolated docker --detached --session <uuid>`. The user-visible problem was
that terminal task containers stayed in Docker as exited containers and kept
multi-GB writable layers on disk.

## Raw Data Captured

- `raw-data/issue-1979.json`: issue title, body, metadata, and embedded comments.
- `raw-data/issue-1979-comments.json`: full issue comment feed.
- `raw-data/pr-1985.json`: prepared PR metadata and CI snapshot at start.
- `raw-data/pr-1985-conversation-comments.json`: PR conversation comments.
- `raw-data/pr-1985-review-comments.json`: inline PR review comments.
- `raw-data/pr-1985-reviews.json`: PR reviews.
- `raw-data/start-issue-140.json`: upstream companion issue.
- `raw-data/start-pr-141.json`: upstream fix PR metadata.
- `raw-data/start-command-latest-version.json`: latest published `start-command`
  version observed during investigation.

No screenshots were present in the issue or PR discussion.

## Timeline

- 2026-06-24 10:26 UTC: Issue 1979 opened, reporting that finished Docker
  isolation containers are never removed and that one deployment accumulated
  about 35 GB of writable layers.
- 2026-06-24 10:46 UTC: Issue comment clarified that #1979 is the event-driven
  auto-reap path, while #1980 is the manual `hive-cleanup` counterpart. The same
  comment requested a case study and an update to the latest fixed
  `start-command` version.
- 2026-06-24 11:44 UTC: Upstream
  [link-foundation/start#141](https://github.com/link-foundation/start/pull/141)
  merged for [start#140](https://github.com/link-foundation/start/issues/140),
  adding Docker cleanup policies and making cleanup the default there.
- 2026-06-24 investigation: `npm view start-command version` reported `0.30.1`.
  Hive Mind Dockerfiles still installed `start-command@0.29.2`.
- 2026-06-24 implementation: Hive Mind added its own terminal-session cleanup
  policy so cleanup is enforced even when an operator has an older or overridden
  `$` binary, and upgraded both image variants to `start-command@0.30.1`.

## Requirements Reconstructed

1. Remove Docker task containers after successful terminal completion.
2. Keep failed Docker task containers by default for investigation.
3. Include inspect and cleanup commands in the Telegram completion message when
   a container is kept.
4. Make the retention policy configurable with
   `HIVE_MIND_KEEP_TASK_CONTAINER=always|on-failure|never`, defaulting to
   `on-failure`.
5. Only act after the existing monitor has determined that the session is
   terminal, preserving the ambiguity guard for Docker `-1`/unknown exit codes.
6. Treat Docker removal as best-effort so a missing or already-removed container
   cannot break completion handling.
7. Ensure the host-side log is inspected before removal, preserving PR URL,
   resume, and disk diagnostics extraction.
8. Update Hive Mind Docker images to the latest `start-command` version that
   contains the upstream Docker cleanup fix.
9. Preserve issue data and analysis in `docs/case-studies/issue-1979`.

## Root Causes

The event-driven monitor had no Docker cleanup step. `monitorSessions()` detected
terminal state, built and sent the completion message, and called
`completeSession()`, which only removed the task from Hive Mind's in-memory and
durable tracking.

The Docker container name was already known: start-command names the native
Docker container after the session UUID, and Hive Mind already used that fact in
`checkDockerContainerRunning()`. The missing piece was not detection, but a
post-terminal action.

The existing `hive-cleanup --docker` path was too broad for this requirement. It
uses host-wide Docker pruning semantics instead of removing the exact task
container whose terminal result Hive Mind just observed.

The Dockerfiles also lagged the upstream fix. Upstream start-command now has
first-class cleanup policies, but the Hive Mind images still pinned `0.29.2`.

## Online Research Notes

Docker's CLI reference confirms `docker rm` removes one or more containers and
that `--force` is the supported force-removal option. It also documents that
`docker container prune` removes all stopped containers, which is useful as a
manual sweep but too broad for this event-driven per-task policy:

- Docker `container rm`: https://docs.docker.com/reference/cli/docker/container/rm/
- Docker `container prune`: https://docs.docker.com/reference/cli/docker/container/prune/

The upstream `start-command` fix in
[link-foundation/start#141](https://github.com/link-foundation/start/pull/141)
adds `--always-cleanup-container`, `--keep-container`,
`--keep-container-on-fail`, and an `--auto-remove-docker-container`
compatibility alias. Hive Mind still keeps its own cleanup because it has richer
success/failure context and can provide Telegram operator guidance.

## Solution Plan

Implemented:

- Add `removeDockerContainer(containerName)` in `src/isolation-runner.lib.mjs`.
  It wraps `docker rm -f <session-uuid>` and never throws.
- Add monitor-level retention policy helpers in `src/session-monitor.lib.mjs`.
  Default behavior is `on-failure`: remove successful containers, keep failed
  containers.
- Append a Docker container section to the completion message only when the
  container is retained.
- Run the cleanup action only after the completion notification path succeeds
  or after Telegram reports the message was already updated.
- Upgrade `Dockerfile` and `Dockerfile.dind` from `start-command@0.29.2` to
  `start-command@0.30.1`.
- Document `HIVE_MIND_KEEP_TASK_CONTAINER` in `.env.example`,
  `docs/CONFIGURATION.md`, and `docs/DOCKER.md`.
- Add `tests/test-issue-1979-docker-container-reaping.mjs` covering default
  success removal, default failure retention, `never`, `always`, invalid policy
  fallback, and non-Docker no-op behavior.

## Alternatives Considered

- Use only the upstream `start-command@0.30.1` default cleanup. This would help
  new images, but it would not protect deployments that override `$`, run an
  older global binary, or need Hive Mind's failure-aware Telegram instructions.
- Use `docker container prune`. Docker supports pruning all stopped containers,
  including filter-based pruning, but that is a host-wide maintenance action.
  This issue needs precise cleanup for the task container whose terminal status
  Hive Mind just observed.
- Add cleanup to `hive-cleanup` only. That is useful for #1980, but it would not
  reclaim disk immediately after each task completes.

## Verification

Primary verification is the new regression test:

```bash
node tests/test-issue-1979-docker-container-reaping.mjs
```

The PR also runs the default test suite and formatting/lint checks before
finalization.
