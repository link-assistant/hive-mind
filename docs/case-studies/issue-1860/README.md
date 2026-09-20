# Issue 1860 Case Study: Docker Isolation Failed

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1860

Pull request: https://github.com/link-assistant/hive-mind/pull/1862

Upstream report: https://github.com/link-foundation/start/issues/132

The Telegram command used `--isolation docker` from a Hive Mind Docker-in-Docker deployment. The spawned Docker container used `ubuntu:latest`, not a Hive Mind image, so the `solve` executable was missing and the session failed with exit code 127.

The fix makes Hive Mind own Docker isolation command construction. Docker-isolated tasks are launched as an explicit `docker run` command inside a tracked start-command `screen` session. This keeps the existing Telegram status/log lifecycle while allowing Hive Mind to select the correct image and mount only the credentials required by the selected tool.

## Evidence Collected

- `raw/issue-1860.json`: GitHub issue body and metadata.
- `raw/issue-comments.json`: issue comments; empty at collection time.
- `raw/pr-1862.json`: initial draft PR metadata.
- `raw/56a99ba3-83a7-4e2d-aecc-7cbad9405209.log`: detached start-command Docker log from the failed task.
- `raw/start-command-npm.json`: published `start-command` npm metadata; latest was `0.28.0`.
- `raw/start-command-related-issues.json`: upstream search for existing Docker mount/image issues; no matching issue was found.
- `raw/start-command-repo.json`: upstream repository metadata confirming issues are enabled.
- `raw/start-command-issue-132.json`: upstream issue filed for native Docker backend image/mount controls.

## Timeline

- 2026-06-08 08:12:29 UTC: start-command started a detached Docker isolation session for `solve https://github.com/link-assistant/hive-mind/issues/1855 --tool codex`.
- 2026-06-08 08:12:35 UTC: the detached Docker log ended with `bash: solve: command not found` and `Exit Code: 127`.
- 2026-06-08 08:23:22 UTC: issue #1860 was opened with the failing Telegram output, `$ --status` output, and a gist log.
- 2026-06-08 10:27:44 UTC: draft PR #1862 was created from branch `issue-1860-49cdf95ff681`.
- 2026-06-08 10:42:09 UTC: upstream issue link-foundation/start#132 was filed for native Docker backend image, env, privileged, and bind-mount controls.

## Requirements From The Issue

1. Reproduce and understand why `--isolation docker` failed.
2. Use the Hive Mind dind image when the parent Hive Mind runtime is the dind image.
3. Spawn isolated tasks in the same CLI/tooling environment as the original image.
4. Remount GitHub auth data for isolated tasks.
5. Remount Claude auth only for `--tool claude` tasks.
6. Remount Codex auth only for `--tool codex` tasks.
7. Preserve all logs and issue data in `docs/case-studies/issue-1860`.
8. Search online/source material for additional facts.
9. Add debug or verbose output if the available data is insufficient.
10. Report related upstream issues with reproduction, workaround, and suggested fix if another project is involved.
11. Apply the fix across all code paths that can launch isolated Telegram work sessions.
12. Add automated regression coverage.

## Root Causes

### Root Cause 1: Wrong Docker Image

The failure log shows:

- `Environment: docker`
- `Image: ubuntu:latest`
- `bash: solve: command not found`
- `Exit Code: 127`

The `solve` CLI is installed in Hive Mind images, not in a generic Ubuntu base image. The child container therefore could not start the requested command.

### Root Cause 2: Native start-command Docker Backend Is Too Narrow

The installed `start-command` release was `0.28.0`. Local source inspection showed Docker isolation supports image selection, but does not expose the bind-mount and environment controls Hive Mind needs for GitHub, Claude, and Codex authentication.

Using only `--image` would fix `solve: command not found`, but not authentication. The task still needs host auth directories inside the child container.

### Root Cause 3: Tool Identity Was Not Passed Into The Isolation Runner

Telegram command handlers already know the selected tool, and queue items store it. `executeWithIsolation` did not receive that tool value, so it could not scope auth mounts by `claude` vs `codex`.

## Online And Source Facts

- Docker documents bind mounts as host files/directories mounted into a container and supports both `--mount` and `--volume`: https://docs.docker.com/engine/storage/bind-mounts/
- Docker's `docker run` reference lists `-v, --volume`, `--workdir`, and related container runtime options: https://docs.docker.com/reference/cli/docker/container/run/
- Docker's container run guide describes bind mounts as a way to share data between host and container: https://docs.docker.com/engine/containers/run/
- The published npm metadata for `start-command` shows latest `0.28.0`: `raw/start-command-npm.json`.
- Upstream `link-foundation/start` has issues enabled and now has the related report: https://github.com/link-foundation/start/issues/132

## Solution Applied

### Docker Isolation Command Builder

`src/isolation-runner.lib.mjs` now has testable builders:

- `getDockerIsolationImage()`
- `getDockerIsolationAuthMounts()`
- `buildDockerIsolationCommand()`
- `buildStartCommandArgs()`

Image selection:

- `HIVE_MIND_DOCKER_ISOLATION_IMAGE` overrides everything for local testing or emergency operations.
- `HIVE_MIND_IMAGE_VARIANT=dind` selects `konard/hive-mind-dind:latest`.
- Other variants select `konard/hive-mind:latest`.

Credential mounts:

- GitHub auth is mounted from `GH_CONFIG_DIR` when set, otherwise from `~/.config/gh`.
- Codex tasks receive `~/.codex` only.
- Claude tasks receive `~/.claude` and `~/.claude.json` only.
- Missing host paths are skipped instead of being created implicitly.

Runtime behavior:

- Docker isolation launches `docker run --rm ... <image> bash -lc <command>`.
- Dind images run with `--privileged`.
- The Docker command is wrapped by `start-command --isolated screen --detached --session <session> -- ...` so Telegram can continue using start-command status and log collection.

### Caller Updates

Both direct and queued Telegram isolated execution now pass `tool` into `executeWithIsolation`:

- `src/telegram-command-execution.lib.mjs`
- `src/telegram-isolation.lib.mjs`

### Monitoring And Logs

`isSessionRunning()` now allows the screen fallback for tracked Docker sessions because the new Docker path is screen-backed.

`resolveLogPath()` now prefers the backend reported by start-command status when it needs to infer a log path. This keeps Docker wrapper sessions pointed at `/tmp/start-command/logs/isolation/screen/...` if `logPath` is missing.

## Alternatives Considered

### Pass `--image` To start-command Native Docker

This would address the missing `solve` binary but not the credential mounts. It would leave Codex and Claude sessions unable to authenticate.

### Add Native Mount Support To start-command First

This is the clean long-term solution and was reported upstream in link-foundation/start#132. It is not sufficient for this PR because Hive Mind needs the issue fixed without waiting for a new upstream release.

### Mount All Credentials Into Every Docker Task

This would be simpler but violates the issue's security requirement. The implemented fix scopes credentials by selected tool.

## Regression Coverage

`tests/test-issue-1860-docker-isolation.mjs` verifies:

- dind parent image selects the dind Docker isolation image.
- explicit image override wins.
- Codex tasks receive GitHub and Codex auth only.
- Claude tasks receive GitHub and Claude auth only.
- `GH_CONFIG_DIR` is respected.
- Docker isolation is tracked via a start-command screen wrapper.
- The wrapper command uses the Hive Mind dind image and preserves solve arguments.
- Dind Docker isolation includes `--privileged`.
- non-Docker isolation keeps the original start-command shape.
- Docker wrapper log fallback uses the screen log directory reported by start-command.
- Direct and queued Telegram isolation both pass the selected tool into the runner.

## Remaining Follow-up

Native Docker backend support in `start-command` would let Hive Mind eventually remove the screen wrapper workaround. The upstream issue includes a reproduction, current workaround, and suggested CLI-level options for image, volume, mount, env, and privileged controls.
