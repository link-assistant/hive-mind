# Case Study: Docker Image Permission Denied on `/home/hive/.config`

**Issue:** [#1419](https://github.com/link-assistant/hive-mind/issues/1419)
**PR:** [#1420](https://github.com/link-assistant/hive-mind/pull/1420)
**Date:** 2026-03-13
**Status:** Fix Implemented

---

## Executive Summary

After switching to a sandbox-based Docker image build (introduced in PR #1394), running `agent --version` inside the container produces:

```
EACCES: permission denied, mkdir '/home/hive/.config/link-assistant-agent'
```

The `hive` user cannot create the required configuration directory because `/home/hive/.config` is owned by `root`, not by `hive`.

**Root Cause:** `ENV HOME=/home/hive` is set globally in the Dockerfile before any `USER` instruction. When the build later switches to `USER root` to run `npx playwright@latest install-deps`, npm/npx resolves `HOME` to `/home/hive` and creates (or touches) `/home/hive/.config` as root. The main `Dockerfile` never corrects this ownership, leaving the directory inaccessible to the `hive` user at runtime.

**Fix:** Override `HOME=/root` for the root-user playwright step, and add `chown -R hive:hive /home/hive` immediately after it — in both `Dockerfile` and `coolify/Dockerfile`.

---

## Problem Statement

From issue #1419, running any command that loads `@link-assistant/agent` produces:

```
hive@88eebf95859b:~$ agent --version
EACCES: permission denied, mkdir '/home/hive/.config/link-assistant-agent'
    path: "/home/hive/.config/link-assistant-agent",
 syscall: "mkdir",
   errno: -13,
    code: "EACCES"

Bun v1.3.10 (Linux x64)
```

The error appears on `agent --version`, which loads the agent module at startup. The issue only appeared after the switch to sandbox-based builds.

---

## Timeline Reconstruction

### Before Sandbox Builds (pre-PR #1394)

- Base image: `ubuntu:24.04`
- Build ran all installation steps as `hive` user or explicitly fixed ownership afterwards
- `/home/hive/.config` was always owned by `hive`
- No permission errors

### PR #1394 (~2026-03-06): Switch to `konard/sandbox` Base Image

- Changed base from `ubuntu:24.04` to `konard/sandbox:1.3.16`
- Introduced pattern of renaming `sandbox` user to `hive` via `usermod`
- Introduced `ENV HOME=/home/hive` set globally (before any `USER` instruction)
- Introduced `USER root` step for `npx playwright@latest install-deps`
- The `USER root` step runs with `HOME=/home/hive` still in effect
- **Bug introduced:** npm/npx creates `/home/hive/.config` as root during this step
- The main `Dockerfile` does not `chown` the directory back to `hive` afterwards

### Issue #1419 (2026-03-13)

- First reported instance of `EACCES` when running `agent --version`
- Symptoms match: `/home/hive/.config` owned by root, `hive` user cannot create subdirectory

---

## Root Cause Analysis

### Primary Root Cause: `HOME=/home/hive` Pollutes Root Steps

The Dockerfile contains:

```dockerfile
# Line 59
ENV HOME=/home/hive
```

This `ENV` instruction is global — it persists across all subsequent `USER` instructions unless explicitly overridden. Later in the build:

```dockerfile
# Lines 133-135 (main Dockerfile)
USER root
RUN npx playwright@latest install-deps 2>/dev/null || true
```

npm/npx (Node.js v9+) uses XDG base directories by default. With `HOME=/home/hive` set, it resolves `$XDG_CONFIG_HOME` to `/home/hive/.config` and may create the directory (or files within it) as `root`.

Since `npx playwright@latest install-deps` downloads packages before invoking playwright's install-deps script, npm's cache/config machinery touches `~/.config` during the download phase.

### Why `{ recursive: true }` Does Not Help

The `@link-assistant/agent` package creates its config directory with:

```typescript
await fs.mkdir(path.join(xdgConfig!, 'link-assistant-agent'), { recursive: true });
```

With `recursive: true`, `fs.mkdir` creates all intermediate directories — **but only if it has permission to write to the parent**. When `/home/hive/.config` exists but is owned by root (mode `755`), the `hive` user can read and execute into it but cannot create new entries inside it. The `recursive: true` flag does not bypass this permission check.

### Why `coolify/Dockerfile` Was Partially Protected

`coolify/Dockerfile` has an explicit fix in its Application Setup section (lines 144-146):

```dockerfile
USER root
RUN mkdir -p /app/claude-logs /app/claude-sessions /app/output && \
    mkdir -p /home/hive/.claude/plugins /home/hive/.config && \
    chown -R hive:hive /app /home/hive/.claude /home/hive/.config
```

Additionally, `coolify/start.sh` (runtime entrypoint) re-applies the chown at startup:

```bash
mkdir -p /home/hive/.claude/plugins /home/hive/.config/gh
chown -R hive:hive /home/hive/.claude /home/hive/.config
```

The main `Dockerfile` has neither of these corrections, so containers run from it have the root-owned `.config` at runtime.

### Contributing Factor: `ENV` Scope in Dockerfile

Docker's `ENV` instruction sets environment variables that persist across layer boundaries and `USER` instructions for all subsequent `RUN` commands. This means that a global `ENV HOME=/home/hive` will be in effect even when `USER root` is active, unless explicitly overridden in the `RUN` command.

---

## Sequence of Events (Build Time)

```
1. USER root
   RUN usermod (sandbox → hive) + chown -R hive:hive /home/hive
   → /home/hive is hive-owned ✓

2. ENV HOME=/home/hive  ← global, persists for all subsequent RUN commands

3. USER hive
   RUN bun install -g ... (AI packages)
   → Creates /home/hive/.bun, /home/hive/.config/... as hive ✓

4. USER hive
   RUN npm install -g @playwright/mcp@latest ...
   → Creates /home/hive/.config/... as hive ✓

5. USER root             ← switches to root, but HOME is still /home/hive
   RUN npx playwright@latest install-deps
   → npm/npx creates or touches /home/hive/.config as ROOT ✗
   → /home/hive/.config now owned by root

6. USER hive
   RUN claude mcp add playwright
   → OK (only writes to /home/hive/.claude, not .config)

--- At runtime ---

7. agent --version
   → @link-assistant/agent tries: mkdir('/home/hive/.config/link-assistant-agent')
   → /home/hive/.config exists, owned by root
   → hive user cannot write → EACCES ✗
```

---

## Fix Applied (PR #1420)

In **both** `Dockerfile` and `coolify/Dockerfile`, the playwright install-deps section was updated:

**Before:**

```dockerfile
# Install Playwright OS dependencies (requires root)
USER root
RUN npx playwright@latest install-deps 2>/dev/null || true

USER hive
```

**After:**

```dockerfile
# Install Playwright OS dependencies (requires root)
# Note: HOME is overridden to /root to prevent root processes from creating
# files under /home/hive/.config with root ownership (see issue #1419)
USER root
RUN HOME=/root npx playwright@latest install-deps 2>/dev/null || true
# Restore hive ownership in case any root step touched /home/hive
RUN chown -R hive:hive /home/hive

USER hive
```

### Why Two Lines?

1. `HOME=/root` — prevents npm/npx from using `/home/hive/.config` as its home directory, so no files are created there as root in the first place.
2. `chown -R hive:hive /home/hive` — defensive cleanup that corrects any existing root-owned files under `/home/hive` regardless of how they were created (e.g., by `opam`, `apt-get`, or future build steps).

The combination ensures both prevention and correction.

---

## Data Evidence

### Error Reproduction Path

1. Build from `konard/sandbox:1.3.16` base
2. Set `ENV HOME=/home/hive`
3. Run any `npm`/`npx` command as `USER root`
4. Check ownership: `ls -la /home/hive/.config` → shows `root root`
5. Switch to `USER hive`, run `agent --version` → EACCES

### Affected Packages

Any package that reads `$XDG_CONFIG_HOME` or `~/.config` at module load time will fail:

- `@link-assistant/agent` (confirmed)
- Any other package that creates `~/.config/<package-name>` on first run

### npm XDG Config Behavior

npm ≥ 9.0 (Node.js 18+) uses XDG Base Directory Specification by default:

- `$XDG_CONFIG_HOME` (or `$HOME/.config`) for configuration
- This is documented in [npm's config documentation](https://docs.npmjs.com/cli/v9/configuring-npm/npmrc)

When `HOME=/home/hive` is set for a root process, npm writes config to `/home/hive/.config` as root.

---

## Related Issues and PRs

- [PR #1394](https://github.com/link-assistant/hive-mind/pull/1394): Introduced sandbox-based builds — where the bug was introduced
- [Issue #1415](https://github.com/link-assistant/hive-mind/issues/1415): Docker build performance disparity (related Dockerfile work)
- [Case Study #1415](../issue-1415/README.md): Previous case study on same Dockerfiles

---

## Lessons Learned

1. **`ENV HOME=` in Dockerfiles is dangerous** when the build later uses `USER root`. The HOME variable is implicitly used by npm, pip, and many other tools to find config directories. Overriding it per-command (`HOME=/root <command>`) is safer.

2. **Always restore ownership after root steps** that touch user home directories. A defensive `chown -R hive:hive /home/hive` after any `USER root` block prevents ownership drift.

3. **Test with `ls -la`** after each `USER root` step during Dockerfile development to catch ownership issues early.

4. **The `coolify/start.sh` runtime fix masked the bug** for Coolify deployments. Standalone containers (used for local testing, CI, and other deployments) were unprotected.
