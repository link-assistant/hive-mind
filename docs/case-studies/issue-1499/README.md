# Case Study: Issue #1499 — Migrate to Sandbox 1.5.0 `/workspace` Layout

## Problem Statement

The hive-mind Docker image inherits from `konard/sandbox:1.3.16` and renames the
`sandbox` user to `hive`, moves the home directory from `/home/sandbox` to
`/home/hive`, and recursively `chown`s thousands of files. This approach is:

1. **Slow** — `chown -R` and `usermod -d ... -m` traverse every installed
   runtime (pyenv, cargo, sdkman, nvm, rbenv, etc.), adding minutes to each
   build.
2. **Fragile** — hardcoded paths in init scripts (`nvm.sh`, `.bashrc`, opam
   config) must be patched with `sed`, which is error-prone and breaks when
   upstream adds new files.
3. **Source of permission bugs** — issues #1419 (root-owned `.config`) and
   #1394 (sandbox→hive migration) stem directly from the rename approach.

## Root Cause Analysis

The coupling between user identity (`sandbox`) and filesystem layout
(`/home/sandbox`) forced every downstream image to choose between:

- **Rename** — expensive, fragile, and error-prone (current hive-mind approach)
- **Symlink** — creates confusion between real and symlinked paths
- **Run as sandbox** — loses the ability to have a distinct user identity

## Solution: Sandbox 1.5.0 `/workspace` Architecture

Sandbox PR [sandbox#73](https://github.com/link-foundation/sandbox/pull/73)
(merged as v1.5.0) decouples user identity from filesystem layout:

| Before (≤1.3.x)                      | After (1.5.0)                           |
| ------------------------------------ | --------------------------------------- |
| `sandbox` user, HOME=`/home/sandbox` | `sandbox` user, HOME=`/workspace`       |
| Downstream must rename user & paths  | Downstream adds user to `sandbox` group |
| `chown -R` on thousands of files     | Zero `chown` needed                     |
| `sed` patches for hardcoded paths    | No path fixups needed                   |
| Permission issues from rename        | ACL-based group permissions             |

### How it works

1. Sandbox creates a `sandbox` group and user with `-d /workspace`
2. All runtimes installed under `/workspace/.*` (`.pyenv`, `.nvm`, `.cargo`, etc.)
3. `setfacl` grants the `sandbox` group rwx access to `/workspace`
4. `chmod 2775` sets the setgid bit so new files inherit group ownership

### Downstream usage (hive-mind)

```dockerfile
FROM konard/sandbox:1.5.0
USER root
RUN useradd -m -d /workspace -s /bin/bash -g sandbox hive
USER hive
ENV HOME=/workspace
WORKDIR /workspace
```

No rename, no chown, no sed patches. The `hive` user is in the `sandbox` group
and has full access to all runtimes in `/workspace`.

## Changes Made

### Dockerfiles (root + coolify)

- Bumped `FROM konard/sandbox:1.3.16` → `FROM konard/sandbox:1.5.0`
- Replaced 30+ lines of user rename / chown / sed with 1-line `useradd`
- Changed all `/home/hive` ENV vars to `/workspace`
- Changed `WORKDIR` from `/home/hive` to `/workspace`

### Scripts

- `coolify/start.sh`: All `/home/hive` paths → `/workspace`
- `docker-restore-auth.sh`: Already used `/workspace` paths (no change needed)
- `scripts/verify-docker-image.sh`: Updated user/path checks

### Configuration

- `coolify/docker-compose.yml`: Volume mounts updated to `/workspace`

### Documentation

- `docs/UBUNTU-SERVER.md`: Updated sandbox version reference

### CI/CD

- `.github/workflows/release.yml`: Removed `usermod` failure check (no longer applicable)

## Impact

- **Build time**: Eliminates expensive `chown -R` and `usermod -d -m` operations
- **Reliability**: No more `sed`-based path fixups that can silently fail
- **Maintainability**: Upstream sandbox changes to runtimes work transparently
- **Security**: ACL-based permissions are more explicit than ownership-based access

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1499
- Sandbox PR: https://github.com/link-foundation/sandbox/pull/73
- Sandbox release: v1.5.0
- Related issues: #1394, #1419
