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

- **Rename** — expensive, fragile, and error-prone (old hive-mind approach)
- **Symlink** — creates confusion between real and symlinked paths
- **Run as sandbox** — the simplest and correct approach

## Solution: Sandbox 1.5.0 `/workspace` Architecture

Sandbox PR [sandbox#73](https://github.com/link-foundation/sandbox/pull/73)
(merged as v1.5.0) decouples user identity from filesystem layout:

| Before (≤1.3.x)                      | After (1.5.0)                           |
| ------------------------------------ | --------------------------------------- |
| `sandbox` user, HOME=`/home/sandbox` | `sandbox` user, HOME=`/workspace`       |
| Downstream must rename user & paths  | Downstream uses sandbox user directly   |
| `chown -R` on thousands of files     | Zero `chown` needed                     |
| `sed` patches for hardcoded paths    | No path fixups needed                   |
| Permission issues from rename        | All files owned by sandbox user         |

### How it works

1. Sandbox creates a `sandbox` group and user with `-d /workspace`
2. All runtimes installed under `/workspace/.*` (`.pyenv`, `.nvm`, `.cargo`, etc.)
3. `/workspace` is owned by the `sandbox` user with proper permissions
4. Downstream images simply use `USER sandbox` — no custom user creation needed

### Downstream usage (hive-mind)

```dockerfile
FROM konard/sandbox:1.5.0
# No user creation needed — just use the default sandbox user
USER sandbox
WORKDIR /workspace
# Install your tools...
```

No rename, no chown, no sed patches, no custom user. The `sandbox` user owns
`/workspace` and has full access to all runtimes.

## Changes Made

### Dockerfiles (root + coolify)

- Bumped `FROM konard/sandbox:1.3.16` → `FROM konard/sandbox:1.5.0`
- Removed all user rename / chown / sed / useradd / chmod operations
- Changed all `/home/hive` ENV vars to `/workspace`
- Changed `USER hive` → `USER sandbox` throughout
- Changed `WORKDIR` from `/home/hive` to `/workspace`

### Scripts

- `coolify/start.sh`: All `hive` user references → `sandbox`
- `scripts/verify-docker-image.sh`: Updated user checks for `sandbox` user

### Configuration

- `coolify/docker-compose.yml`: Volume mounts updated to `/workspace`

### Documentation

- `docs/UBUNTU-SERVER.md`: Updated user reference
- `docs/DOCKER.md`: Updated volume names

### CI/CD

- `.github/workflows/release.yml`: Removed obsolete `useradd` failure check

## Impact

- **Build time**: Eliminates expensive `chown -R`, `usermod -d -m`, and `chmod -R g+w` operations
- **Reliability**: No more `sed`-based path fixups or custom user creation
- **Maintainability**: Upstream sandbox changes to runtimes work transparently
- **Simplicity**: No custom user — just use what sandbox provides

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1499
- Sandbox PR: https://github.com/link-foundation/sandbox/pull/73
- Sandbox release: v1.5.0
- Sandbox browser preinstallation request: https://github.com/link-foundation/sandbox/issues/74
- Related issues: #1394, #1419
