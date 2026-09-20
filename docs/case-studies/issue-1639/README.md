# Case Study: Migrate Docker Images From Sandbox To Box (Issue #1639)

## Overview

Issue #1639 requested migration from `konard/sandbox` to the current full
`konard/box` image, with all Docker-related paths updated from the old
`/workspace` home assumption to Box's standard `/home/box` home directory and
from the old `sandbox` user to the `box` user.

The issue also asked to double-check the upstream facts, collect repository and
external data, list every requirement, and propose solution plans before
implementing.

## Preserved Data

- `data/issue-1639.json`: issue title, body, labels, timestamps, and URL.
- `data/issue-1639-comments.json`: issue comments; empty at investigation time.
- `data/pr-1644.json`: prepared PR metadata before implementation.
- `data/pr-1644-review-comments.json`: PR inline review comments; empty.
- `data/pr-1644-reviews.json`: PR reviews; empty.
- `data/box-repo.json`: upstream `link-foundation/box` repository metadata.
- `data/box-release-v2.0.1.json`: upstream Box release metadata.
- `data/dockerhub-konard-box-tags.json`: Docker Hub tags for `konard/box`.
- `data/dockerhub-konard-sandbox-tags.json`: Docker Hub tags for
  `konard/sandbox` for comparison.
- `data/box-v2.0.1-Dockerfile`: upstream Box Dockerfile at the selected tag.
- `data/box-v2.0.1-README.md`: upstream Box README at the selected tag.
- `data/box-v2.0.1-entrypoint.sh`: upstream Box entrypoint at the selected tag.
- `logs/docker-box-migration-before.log`: failing migration regression test
  before the Docker changes.
- `logs/docker-box-migration-after.log`: passing migration regression test
  after the Docker changes.
- `logs/npm-ci.log`: dependency installation log for local verification.
- `logs/npm-test-after-format.log`: full `npm test` verification after
  formatting.
- `logs/lint-after-format.log`: ESLint verification after formatting.
- `logs/format-check-after.log`: Prettier check after formatting.
- `logs/docs-validation-after-format.log`: documentation validation after
  formatting.
- `logs/git-diff-check.log`: whitespace check with `git diff --check`.
- `logs/docker-command-check.log`: local Docker availability check.

## External Sources Checked

- Upstream repository:
  <https://github.com/link-foundation/box>
- Upstream release v2.0.1:
  <https://github.com/link-foundation/box/releases/tag/v2.0.1>
- Upstream Dockerfile at v2.0.1:
  <https://github.com/link-foundation/box/blob/v2.0.1/Dockerfile>
- Upstream README at v2.0.1:
  <https://github.com/link-foundation/box/blob/v2.0.1/README.md>
- Docker Hub tags for `konard/box`:
  <https://hub.docker.com/r/konard/box/tags>
- Docker Hub tags for `konard/sandbox`:
  <https://hub.docker.com/r/konard/sandbox/tags>

## Facts Verified

1. `link-foundation/box` latest release is `v2.0.1`, published on
   2026-04-08.
2. Docker Hub `konard/box:latest` and `konard/box:2.0.1` point to the same
   multi-architecture manifest digest in the captured Docker Hub metadata.
3. The upstream Box full Dockerfile uses `USER box`, `WORKDIR /home/box`, and
   `ENV HOME=/home/box`.
4. The upstream Box README documents that the container runs as the `box` user
   with home directory `/home/box`.
5. The previous `konard/sandbox:1.6.0` line in this repository was still tied
   to the older `sandbox` user and `/workspace` path assumptions.

## Requirements From The Issue

1. Use the latest full `konard/box` image instead of `konard/sandbox`.
2. Double-check that the latest Box image uses `/home/box`, not `/workplace` or
   this repository's previous `/workspace` convention.
3. Double-check that the runtime user is now `box`.
4. Update Dockerfiles accordingly.
5. Keep Dockerfiles simple and predictable, avoiding non-standard home paths.
6. Preserve repository data and external research under
   `docs/case-studies/issue-1639`.
7. List each requirement and compare possible solutions.
8. Search online for additional facts and data.

## Options Considered

### Option A: Use `konard/box:latest`

This directly follows the word "latest" in the issue, but it would make builds
less reproducible. A future upstream Box release could change installed
tooling, paths, or package versions without any hive-mind change.

### Option B: Pin The Current Latest Release

Use `konard/box:2.0.1`, the current latest release verified from GitHub and
Docker Hub at implementation time.

This keeps the build reproducible while still satisfying the migration to the
latest full Box image available for this issue. This is the option implemented.

### Option C: Keep `/workspace` As An App-Specific Home

This would reduce the number of path changes, but it would preserve the
non-standard configuration the issue explicitly wanted to remove. It would also
fight the upstream Box image's documented home directory.

## Implementation

The implementation migrates the active Docker surface to Box:

- `Dockerfile` now uses `FROM konard/box:2.0.1`, runs as `box`, and uses
  `/home/box` for all user-local runtime paths.
- `coolify/Dockerfile` uses the same Box base and path assumptions. It starts
  as root only for bind-mounted volume ownership repair, then `start.sh` drops
  to the `box` user before running hive-mind.
- `coolify/start.sh`, Docker Compose files, Docker helper scripts, Helm
  deployment paths, verification scripts, release workflow logs, and Docker
  docs now use `/home/box` and `box`.
- A regression test, `tests/test-docker-box-migration.mjs`, verifies the active
  Docker files no longer use the old sandbox base, user, or `/workspace` path.
- A patch changeset records the Docker image migration for release notes.

### Preserved Legacy Bare-Metal Reference

The `UBUNTU-SERVER` docs (en, ru, zh, hi) keep the legacy Hive Mind bare-metal
install script around as the "Option 2" install path, pinned to commit
`4f027b32`:
<https://github.com/link-assistant/hive-mind/blob/4f027b32/scripts/ubuntu-24-server-install.sh>

This was added in response to PR review feedback on #1644. The upstream Box
image is universal and does not ship Hive Mind specific tooling, so the script
that last bundled the full Hive Mind software stack on top of Ubuntu 24.04 is
still the only source for the non-Docker install path. The link is explicitly
pinned to the SHA that carried that script to avoid drift.

## Verification

The new regression test failed before implementation because `Dockerfile` still
used `konard/sandbox`. See `logs/docker-box-migration-before.log`.

After implementation, the same test passes. See
`logs/docker-box-migration-after.log`.

Local verification also passed:

- `npm test`
- `npm run lint`
- `npm run format:check`
- `node tests/docs-validation.mjs`
- `git diff --check`

The local workspace did not have the `docker` command available, so Docker image
build verification is left to the repository Docker CI job. See
`logs/docker-command-check.log`.
