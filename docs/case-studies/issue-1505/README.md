# Case Study: Issue #1505 — Simplify Dockerfile After Sandbox Ships Pre-installed Browsers

## Problem Statement

The hive-mind Dockerfile (both root and `coolify/Dockerfile`) had several interrelated
issues stemming from sandbox 1.5.0 not shipping pre-installed Playwright browsers:

1. **`USER root` for tool installation** — the Dockerfile switched to root to create
   a node-bin symlink and install opam via `apt-get`, then to sandbox for tool installs,
   creating an unnecessary privilege escalation surface.

2. **`sudo playwright install chrome` as root** — this command created `/workspace/.local`
   owned by root, causing `EACCES: permission denied` errors at runtime when the sandbox
   user tried to create directories like `/workspace/.local/share/link-assistant-agent`
   and `/workspace/.local/state`.

3. **Silent failure cascade via `|| echo`** — every `bun install -g` command used
   `|| echo "not yet published"` which silently swallowed real errors (EACCES, network
   failures, etc.). When `/workspace/.local` was root-owned, bun hit EACCES but the
   `|| echo` pattern hid it, leaving tools partially installed or broken at runtime.

4. **~30 lines of Playwright setup** — browser installation, architecture checks, and
   `--force` npm installs that duplicated work the sandbox image should provide.

## Root Cause Analysis

### Timeline of Events

1. **Sandbox 1.5.0** introduced `/workspace` as the shared directory owned by
   `sandbox:sandbox`, but did not pre-install Playwright browsers.

2. **Hive-mind** inherited sandbox 1.5.0 and added its own browser installation.
   The `sudo env "PATH=$PATH" HOME=/workspace playwright install chrome` command
   was needed because Chrome installs to system paths requiring root access.

3. **The root ownership bug**: when `sudo` runs with `HOME=/workspace`, any
   directories created under `/workspace` (specifically `/workspace/.local`) are
   owned by root. The sandbox user cannot write to them at runtime.

4. **The silent failure cascade**: the `|| echo "not yet published"` pattern on
   `bun install -g` was originally intended to handle packages that weren't published
   yet. However, it also swallowed permission errors caused by the root-owned
   `/workspace/.local`. Other tools (e.g., Gemini CLI) that needed `/workspace/.gemini`
   also failed silently during build.

### Root Causes

| Layer                | Root Cause                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Sandbox 1.5.0        | Did not pre-install browsers, forcing downstream images to handle complex installation        |
| Hive-mind Dockerfile | Used `USER root` + `sudo` for browser installation, creating root-owned files in `/workspace` |
| Hive-mind Dockerfile | Used `\|\| echo` pattern that hid real installation failures (EACCES, network errors)         |
| Hive-mind Dockerfile | Installed opam via `apt-get` redundantly (sandbox already provides it via rocq image)         |

## Solution

### Dependency: Sandbox 1.6.0 (sandbox#74)

[sandbox#74](https://github.com/link-foundation/sandbox/issues/74) was resolved and
released as [sandbox v1.6.0](https://github.com/link-foundation/sandbox/releases/tag/v1.6.0)
on 2026-03-31. Key changes:

- Playwright browsers (chromium, firefox, webkit, msedge, chrome) pre-installed as
  sandbox user in the JS sandbox image
- `@playwright/test` pre-installed
- `/workspace` ownership explicitly restored after all `COPY --from` operations
- All browser binaries installed to `~/.cache/ms-playwright/` (user-writable),
  not system paths

### Changes Made in Hive-mind

#### 1. Bumped sandbox version: 1.5.0 -> 1.6.0

Both `Dockerfile` and `coolify/Dockerfile` updated to `FROM konard/sandbox:1.6.0`.

#### 2. Eliminated `USER root` for tool installation

Before (sandbox 1.5.0):

```dockerfile
FROM konard/sandbox:1.5.0
USER root
RUN apt-get update -y && apt-get install -y opam && ...
RUN ln -sf ... /workspace/.node-bin
USER sandbox
```

After (sandbox 1.6.0):

```dockerfile
FROM konard/sandbox:1.6.0
USER sandbox
RUN ln -sf ... /workspace/.node-bin
```

- **opam**: no longer installed via `apt-get` — sandbox 1.6.0 provides it in
  `/workspace/.local/bin` via the rocq image
- **node-bin symlink**: created as sandbox user (only needs write access to
  `/workspace`, which sandbox user owns)

#### 3. Removed all Playwright browser installation (~15 lines removed)

Before:

```dockerfile
RUN npm install -g @playwright/mcp@latest @playwright/test@latest --no-fund --force
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then \
      playwright install chromium firefox webkit msedge chromium-headless-shell && \
      sudo env "PATH=$PATH" HOME=/workspace playwright install chrome; \
    else \
      playwright install chromium firefox webkit chromium-headless-shell; \
    fi
```

After:

```dockerfile
RUN npm install -g @playwright/mcp@latest --no-fund --force
```

Only `@playwright/mcp` remains (AI-specific MCP server, not in sandbox).

#### 4. Removed silent failure fallbacks

Before:

```dockerfile
RUN bun install -g @anthropic-ai/claude-code || echo "claude-code: not yet published" && \
    bun install -g @openai/codex || echo "codex: not yet published"
```

After:

```dockerfile
RUN bun install -g @anthropic-ai/claude-code && \
    bun install -g @openai/codex
```

Every installation now fails the build on error, catching permission issues and
network failures immediately instead of leaving broken tools in the image.

#### 5. Updated verify-docker-image.sh

Chrome is no longer installed system-wide (`/usr/bin/google-chrome`). Updated the
verification script to check the Playwright cache directory first, with a fallback
to `command -v google-chrome` for backward compatibility.

#### 6. Updated docs/UBUNTU-SERVER.md

Updated sandbox version references from 1.5.0 to 1.6.0.

## Impact

| Metric                                  | Before                          | After                      |
| --------------------------------------- | ------------------------------- | -------------------------- |
| Dockerfile lines (root)                 | 114                             | 87                         |
| `USER root` blocks (root Dockerfile)    | 1                               | 0                          |
| `USER root` blocks (coolify Dockerfile) | 2                               | 1 (only for /app setup)    |
| `\|\| echo` silent fallbacks            | 15                              | 0                          |
| Playwright install commands             | 2 RUN blocks                    | 0                          |
| `sudo` usage                            | 1 (`playwright install chrome`) | 0                          |
| Permission bugs (EACCES)                | root-owned `/workspace/.local`  | All files owned by sandbox |

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1505
- Sandbox dependency: https://github.com/link-foundation/sandbox/issues/74
- Sandbox release: https://github.com/link-foundation/sandbox/releases/tag/v1.6.0
- Previous migration: https://github.com/link-assistant/hive-mind/issues/1499
- Permission bug context: https://github.com/link-assistant/hive-mind/issues/1419
