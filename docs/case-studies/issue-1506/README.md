# Case Study: Issue #1506 - /version should show browsers, browser tools, and all preinstalled software

## Summary

The `/version` Telegram bot command was missing version reporting for several categories
of preinstalled software: browsers (Chrome, Chromium, Firefox, Edge), browser automation
tools (Playwright Test, Puppeteer Browsers), language runtimes (Ruby, Kotlin, Swift, R),
and development tools (GitLab CLI, NASM, FASM, etc.).

The root cause was an incomplete `VERSION_COMMANDS` array in `version-info.lib.mjs` that
did not match the actual software installed by the Docker image stack.

## Root Cause Analysis

### The Dockerfile Stack

The hive-mind Docker image inherits from `konard/sandbox:1.5.0`, which is built from
a multi-stage Dockerfile chain:

```
sandbox-js (Node.js, Bun, Deno, NVM, Playwright deps)
  -> essentials-sandbox (gh, glab, @puppeteer/browsers, build tools)
    -> full-sandbox (Python, Go, Rust, Java, Kotlin, Ruby, Swift, PHP, .NET, R, Perl, OCaml, Lean, C/C++)
      -> konard/sandbox:1.5.0 (pinned release)
        -> hive-mind (AI tools, Playwright browsers, MCP)
```

### Gap Analysis

The `VERSION_COMMANDS` array was created when fewer tools were installed. As the sandbox
image grew to include more languages and tools, the version command was not updated to match.

| Category | Installed in Docker | Reported by /version | Status |
| --- | --- | --- | --- |
| Google Chrome | hive-mind Dockerfile (x86_64) | No | **Missing** |
| Chromium | hive-mind Dockerfile | No | **Missing** |
| Firefox | hive-mind Dockerfile | No | **Missing** |
| Microsoft Edge | hive-mind Dockerfile (x86_64) | No | **Missing** |
| @playwright/test | hive-mind Dockerfile | No | **Missing** |
| @puppeteer/browsers | essentials-sandbox | No | **Missing** |
| Ruby/rbenv | full-sandbox | No | **Missing** |
| Kotlin | full-sandbox | No | **Missing** |
| Swift | full-sandbox | No | **Missing** |
| R | full-sandbox | No | **Missing** |
| GitLab CLI (glab) | essentials-sandbox | No | **Missing** |
| NASM | full-sandbox | No | **Missing** |
| FASM | full-sandbox (x86_64) | No | **Missing** |
| wget | essentials-sandbox | No | **Missing** |
| screen | essentials-sandbox | No | **Missing** |

### Why It Matters

Users rely on `/version` to verify their environment has the expected tools before
starting work. Missing entries for browsers were especially impactful since browser
automation (Playwright, Puppeteer) is a core capability of the sandbox.

## Solution

### Changes to `src/version-info.lib.mjs`

1. **Added browser version commands**: `google-chrome --version`, `chromium --version`
   (with `chromium-browser` fallback), `firefox --version`, `microsoft-edge --version`
   (with `microsoft-edge-stable` fallback).

2. **Added browser automation tools**: `@playwright/test` (npm global), `@puppeteer/browsers`
   (npm global).

3. **Added language runtimes**: Ruby (`ruby --version`, `rbenv --version`), Kotlin
   (`kotlin -version`), Swift (`swift --version`), R (`R --version`).

4. **Added development tools**: GitLab CLI (`glab --version`), NASM (`nasm --version`),
   FASM (`fasm`), wget (`wget --version`), screen (`screen --version`).

5. **Reorganized formatter sections**:
   - Moved Playwright/Puppeteer from "Development Tools" to new "Browser Automation" section
   - Added new "Browsers" section for browser versions
   - Added NASM/FASM to renamed "C/C++/Assembly" section
   - Added new sections for Ruby, Kotlin, Swift, R

### Performance Impact

All new commands execute in parallel via `Promise.all` (established in issue #1320),
so adding 14 new version checks does not significantly impact total gather time
(still bounded by the slowest command, typically ~5s).

## Verification

- Unit tests added in `tests/version-info.test.mjs` covering all new sections
- Tests verify correct section ordering, conditional display, and key presence
- All 18 tests pass

## Lessons Learned

1. **Docker image changes should trigger version command updates**: When adding software
   to the Dockerfile stack, the `VERSION_COMMANDS` array should be updated in the same
   PR or a follow-up issue should be filed.

2. **Browser versions are critical metadata**: Since browser automation is a core feature,
   browser versions should have been included from the beginning of Playwright integration.

3. **The formatter's section organization matters**: Grouping Playwright under "Development
   Tools" was misleading. Separating "Browsers" and "Browser Automation" into distinct
   sections makes the output clearer and easier to scan.
