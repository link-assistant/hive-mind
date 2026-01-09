# Case Study: Docker Publish Failure (Issue #1084)

## Executive Summary

The Docker publish workflow failed on arm64 architecture due to Google Chrome not being available for Linux arm64 through Playwright's installation mechanism. This is a known platform limitation where Chrome stable builds are not provided for arm64 Linux systems.

## Timeline of Events

| Time (UTC) | Event |
|------------|-------|
| 2026-01-08 04:42:38 | CI workflow triggered on `main` branch |
| 2026-01-08 04:48:22 | npm publish succeeded (v1.2.1) |
| 2026-01-08 04:48:29 | GitHub release v1.2.1 created |
| 2026-01-08 04:48:47 | Docker Publish (linux/amd64) started |
| 2026-01-08 04:48:51 | Docker Publish (linux/arm64) started |
| 2026-01-08 04:50:33 | Docker Publish (linux/amd64) completed successfully |
| 2026-01-08 05:04:59 | arm64: Chromium installed successfully |
| 2026-01-08 05:04:59 | arm64: Chrome installation started |
| 2026-01-08 05:05:11 | arm64: Chrome installation failed with exit code 1 |
| 2026-01-08 05:05:12 | Docker Publish (linux/arm64) failed |

## Root Cause Analysis

### Primary Cause

The `ubuntu-24-server-install.sh` script attempts to install all Playwright browsers including Google Chrome:

```bash
BROWSERS_TO_INSTALL="chromium chrome firefox webkit msedge"

for browser in $BROWSERS_TO_INSTALL; do
  log_info "Installing Playwright browser: $browser..."
  playwright install "$browser" --with-deps > "$BROWSER_INSTALL_LOG" 2>&1
  # ...
done
```

The problem is that **Google Chrome stable builds are not available for Linux arm64 through Playwright**. When `playwright install chrome` is executed on arm64, it fails with:

```
ERROR: not supported on Linux Arm64
```

### Technical Details

1. **Playwright Browser Support Matrix (as of 2025)**:
   - **Chromium**: Available on x86_64 and arm64
   - **Chrome (stable)**: Only available on x86_64
   - **Firefox**: Available on x86_64 and arm64
   - **WebKit**: Available on x86_64 and arm64
   - **Edge**: Only available on x86_64

2. **Playwright 1.57+ Changes**: Starting with Playwright 1.57, the default channel switched from Chromium to Chrome for Testing builds. However, on arm64 Linux, Playwright continues to use Chromium because Chrome for Testing builds are not available for arm64.

3. **The Script's Error Handling Was Insufficient**: The script did check for browser installation failures but used `set -euo pipefail` at the top, which causes the script to exit on any non-zero exit code. The browser installation loop didn't properly handle the arm64-specific Chrome failure.

### Why amd64 Succeeded

The amd64 build completed successfully because:
1. Chrome stable is available for Linux x86_64
2. All browsers (chromium, chrome, firefox, webkit, msedge) installed without issues

### Evidence from CI Logs

```
Docker Publish (linux/arm64) 2026-01-08T05:04:59.2380209Z #10 936.8 [*] Installing Playwright browser: chrome...
Docker Publish (linux/arm64) 2026-01-08T05:05:11.4467920Z #10 ERROR: process "/bin/sh -c chmod +x /tmp/ubuntu-24-server-install.sh && DOCKER_BUILD=1 bash /tmp/ubuntu-24-server-install.sh && rm -f /tmp/ubuntu-24-server-install.sh" did not complete successfully: exit code: 1
```

## Impact Assessment

### Affected Components
- Docker image for arm64 architecture not published to Docker Hub
- Users on Apple Silicon Macs (M1/M2/M3) cannot use the Docker image
- ARM-based servers (AWS Graviton, Azure Ampere, etc.) cannot use the Docker image

### What Still Works
- npm package v1.2.1 was published successfully
- GitHub release v1.2.1 was created
- amd64 Docker image was published (if manifest was created conditionally)

## Solution Options

### Option 1: Skip Chrome on arm64 (Recommended)

Modify the browser installation logic to detect arm64 architecture and skip Chrome and Edge installation:

```bash
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  # On arm64, only install browsers that are supported
  BROWSERS_TO_INSTALL="chromium firefox webkit"
  log_note "Running on arm64 - Chrome and Edge are not available, installing: $BROWSERS_TO_INSTALL"
else
  # On x86_64, install all browsers
  BROWSERS_TO_INSTALL="chromium chrome firefox webkit msedge"
fi
```

**Pros:**
- Simple fix
- arm64 builds will succeed
- Users still get the most important browsers (Chromium, Firefox, WebKit)

**Cons:**
- arm64 users won't have Chrome/Edge in the container (but Chromium is functionally equivalent)

### Option 2: Continue on Failure (Workaround)

Modify the installation loop to continue even if a browser fails to install:

```bash
for browser in $BROWSERS_TO_INSTALL; do
  if ! playwright install "$browser" --with-deps > "$BROWSER_INSTALL_LOG" 2>&1; then
    if grep -qi "not supported\|not available\|cannot download\|unsupported" "$BROWSER_INSTALL_LOG" 2>/dev/null; then
      log_note "$browser is not available on this platform (skipping)"
    else
      log_warning "$browser installation failed"
    fi
  else
    log_success "$browser installed successfully"
  fi
done
```

**Note:** The script already has similar logic, but `set -e` causes it to exit before reaching the conditional checks.

### Option 3: Use Chromium-Only for arm64

Simplify the arm64 build by only installing Chromium (which covers 99% of use cases):

```bash
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  playwright install chromium --with-deps
else
  playwright install --with-deps  # All browsers
fi
```

## Recommended Fix

**Implement Option 1** with the following changes to `scripts/ubuntu-24-server-install.sh`:

1. Add architecture detection before the browser installation loop
2. Set `BROWSERS_TO_INSTALL` based on architecture
3. Keep the existing error handling for edge cases

## Related References

- [Playwright Browsers Documentation](https://playwright.dev/docs/browsers)
- [GitHub Issue: playwright-mcp-docker #1](https://github.com/iuill/playwright-mcp-docker/issues/1) - Same issue reported
- [Playwright Release Notes 1.57](https://playwright.dev/docs/release-notes) - Chrome for Testing changes
- [Fix Playwright MCP on Claude Code](https://notes.myhro.info/2025/07/fix-playwright-mcp-on-claude-code/) - Related workaround

## Files

- `ci-run-20805753647.log.gz` - Full CI workflow log from the failed run (gzip compressed)
- `analysis.md` - This analysis document

## Action Items

1. [x] Identify root cause
2. [x] Document the issue
3. [ ] Implement fix in `scripts/ubuntu-24-server-install.sh`
4. [ ] Test locally on arm64 if possible
5. [ ] Update PR and verify CI passes
