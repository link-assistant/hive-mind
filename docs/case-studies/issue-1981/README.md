# Issue 1981: Safer Disk and Isolation Defaults

## Summary

Issue #1981 asked for default-only hardening after production disk exhaustion caused isolated tasks to die. The existing gates were present, but their shipped defaults allowed work to start too late:

- Disk usage queue threshold: `HIVE_MIND_DISK_THRESHOLD` default `0.9` -> `0.8`.
- Absolute free-space gate: `HIVE_MIND_MIN_DISK_SPACE_MB` default `2048` -> `10240`.
- Disk threshold queue strategy: default immediate rejection -> normal wait/enqueue.
- Isolation default: `--isolation screen` -> `--isolation docker`.

The implementation keeps the existing environment variables and CLI flags. No new `HIVE_MIND_MIN_FREE_DISK_GB` setting was added because `HIVE_MIND_MIN_DISK_SPACE_MB` already provides the absolute free-space gate.

## Data Artifacts

Local artifacts captured for this case study:

- `raw-data/issue-1981.json` - issue title/body and metadata.
- `raw-data/issue-1981-comments.json` - issue comments, including the no-new-variable correction and the later disk-wait/Docker-default requirement.
- `raw-data/pr-1986.json` - prepared PR metadata before implementation.
- `raw-data/related-prs-disk-threshold.json` - merged PRs related to queue and disk thresholds.
- `raw-data/related-prs-docker-isolation.json` - merged PRs related to Docker isolation stability.
- `raw-data/code-search-*.json` - GitHub code-search results for the affected knobs.
- `test-logs/red-test-issue-1981.log` - focused regression before the implementation, failing on all changed defaults.
- `test-logs/green-test-issue-1981.log` - same regression after implementation.
- `test-logs/npm-ci.log` - dependency install log for this workspace.

## Requirements

1. Change `HIVE_MIND_DISK_THRESHOLD` built-in default from `0.9` to `0.8` in both the primary `thresholds.disk` config and legacy `DISK_THRESHOLD` alias.
2. Change `HIVE_MIND_MIN_DISK_SPACE_MB` built-in default from `2048` MB to `10240` MB.
3. Do not add a new absolute free-space variable.
4. Change the disk threshold default strategy from `reject` to regular wait/enqueue.
5. Make Docker isolation the default instead of screen isolation.
6. Update English and localized configuration docs.
7. Update Coolify example references if present.
8. Include tests that reproduce and verify the changed behavior.
9. Collect data and document the investigation, related work, external references, options, and implemented plan in this directory.

## Existing Components

The issue did not need new infrastructure:

- `src/queue-config.lib.mjs` already centralizes queue threshold values and strategies.
- `src/telegram-solve-queue.lib.mjs` already supports `reject`, `enqueue`, and `dequeue-one-at-a-time`; disk only needed a safer default strategy.
- `src/config.lib.mjs`, `src/memory-check.mjs`, `src/solve.validation.lib.mjs`, `src/solve.config.lib.mjs`, `src/solve.mjs`, and `src/hive.mjs` already provide the absolute disk-space gate.
- `src/hive.config.lib.mjs` inherits solve options from `SOLVE_OPTION_DEFINITIONS`, so changing the solve definition updates hive parsing too.
- `src/telegram-bot.mjs`, `src/telegram-isolation.lib.mjs`, and `src/isolation-runner.lib.mjs` already support Docker isolation and startup preflight.
- `src/task.config.lib.mjs` also exposes a standalone `--isolation` default and was updated because the issue wording was broad.
- `coolify/start.sh` already forwards `MIN_DISK_SPACE` into `--min-disk-space`; only the example value needed to match the safer default.

## Related Work

Disk and queue history:

- PR #1156 introduced one-at-a-time disk threshold behavior for issue #1155.
- PR #1254 added configurable queue thresholds and strategies.
- PR #1243 made `/limits` display actual queue thresholds.
- PR #1556 changed disk threshold behavior to immediate rejection when the limit is exceeded.
- PR #1947 added working-tree size logging and warnings for large disk growth.

Docker isolation history:

- PR #1915 moved `--isolation docker` to native Docker isolation.
- PR #1880 reused the host image instead of re-downloading inside Docker-in-Docker.
- PR #1926 addressed Docker-in-Docker disk blowups and child image drift.
- PR #1940 mounted git identity and improved Docker status checks.
- PR #1948 surfaced Docker isolation session IDs immediately.
- PR #1982 made Docker cleanup session-aware.
- PR #1984 preserved queued per-command isolation.
- PR #1985 reaped completed task containers.

These PRs made Docker isolation stable enough to become the default and showed that disk pressure is a recurring operational failure mode.

## External References

Official references used while evaluating the disk and Docker behavior:

- Docker pruning documentation: unused Docker objects are not removed automatically and require prune commands, which explains why Docker task churn can accumulate disk usage unless cleanup paths run. <https://docs.docker.com/engine/manage-resources/pruning/>
- Docker overlay2 documentation: Docker stores layered filesystem data under the Docker storage driver and warns not to manipulate those directories manually. <https://docs.docker.com/engine/storage/drivers/overlayfs-driver/>
- Kubernetes node-pressure eviction: Kubernetes treats disk pressure as a node condition and reclaims/evicts under pressure, supporting an earlier admission threshold rather than waiting until disks are almost full. <https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/>
- Kubernetes local ephemeral storage: writable layers, logs, and emptyDir usage count toward local ephemeral storage pressure. <https://kubernetes.io/docs/concepts/storage/ephemeral-storage/>
- GNU `df` manual: `df` reports filesystem availability for the containing filesystem, which is the basis for the existing local disk-space check. <https://manpages.debian.org/buster/coreutils/df.1.en.html>

## Options Considered

### Option A: Only Change Disk Ratio and Absolute Free-Space Defaults

This satisfies the first issue revision, but misses the later comment asking for disk wait mode and Docker isolation by default. It also leaves callers with immediate rejection at 80%, which is safer for disk but less useful operationally when queueing can wait.

### Option B: Add a New `HIVE_MIND_MIN_FREE_DISK_GB` Variable

Rejected. The issue explicitly corrected this: `HIVE_MIND_MIN_DISK_SPACE_MB` already exists and is documented. Adding another variable would create duplicate configuration paths and migration confusion.

### Option C: Change Disk Threshold Strategy to One-at-a-Time

Rejected for this issue. `dequeue-one-at-a-time` is still available as an override, but the requested behavior was regular wait. `enqueue` matches the existing wait path used by RAM and CPU thresholds.

### Option D: Make Docker the Default for Telegram Only

Partially sufficient, but the issue phrasing was broad. Telegram bot isolation was the main context, and the standalone `task` command also had a real `screen` default. Updating both avoids leaving a visible active CLI default behind.

### Implemented Plan

Implemented Option A plus the later requirements:

- Updated queue disk default to `0.8` and default strategy to `enqueue`.
- Updated absolute disk-space defaults to `10240` MB through shared config, memory checks, solve config, solve runtime fallback, and hive runtime fallback.
- Updated Telegram bot isolation default to Docker while preserving `TELEGRAM_ISOLATION=` and `--isolation ''` opt-out.
- Updated standalone task isolation default to Docker.
- Updated `/stop` guidance that still recommended `--isolation screen`.
- Updated English, Hindi, Chinese, and Russian configuration docs.
- Updated `coolify/.env.example` `MIN_DISK_SPACE` example to `10240`.
- Added focused regression coverage in `tests/test-issue-1981-disk-defaults.mjs`.
- Updated older default assertions in queue, limits display, and issue #1694 tests.

## Verification

Before implementation, `node tests/test-issue-1981-disk-defaults.mjs` failed because the workspace still had:

- disk threshold `0.9`,
- disk strategy `reject`,
- absolute disk-space default `2048`,
- solve/hive parser default `2048`,
- Telegram isolation default `screen`.

After implementation, the same test passed with 8 checks:

- queue disk threshold and display default to 80%,
- disk strategy defaults to enqueue/wait,
- shared and solve free-space defaults are 10240 MB,
- solve and hive parsers expose 10240 MB,
- task parser defaults to Docker isolation,
- Telegram bot dry-run defaults to Docker isolation,
- explicit empty Telegram isolation still opts out.

Additional focused and broader checks are recorded in the PR validation notes.
