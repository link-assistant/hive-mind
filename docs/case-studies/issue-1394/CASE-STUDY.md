# Case Study: Optimize Docker Building CI/CD by Using sandbox:latest

**Issue:** [#1394](https://github.com/link-assistant/hive-mind/issues/1394)

## Problem Statement

The hive-mind Docker CI/CD pipeline experiences two distinct problems:

1. **Original build-from-scratch problem** (addressed in PR #1396): The Dockerfile used to build from `ubuntu:24.04` and ran a comprehensive installation script (`scripts/ubuntu-24-server-install.sh`) that installed all development tools from scratch. This took 10-15+ minutes and risked timeouts for complex tools like Homebrew, PHP, and Perl.

2. **Residual GHA cache export timeout** (addressed in this iteration): Even after switching to `konard/sandbox:latest` as the base image, the amd64 Docker Publish CI job is **cancelled** mid-execution because the GitHub Actions (GHA) cache export phase takes longer than the 30-minute job timeout.

### Failing CI Run

- **Run:** [#22902572178](https://github.com/link-assistant/hive-mind/actions/runs/22902572178)
- **Job (amd64, cancelled):** [#66453518607](https://github.com/link-assistant/hive-mind/actions/runs/22902572178/job/66453518607)
- **Job (arm64, success):** [#66453518615](https://github.com/link-assistant/hive-mind/actions/runs/22902572178/job/66453518615)
- **Logs saved:** `ci-logs/` directory in this case study folder

---

## Timeline Reconstruction (amd64 Build - Cancelled)

From analysis of the raw CI logs (`ci-logs/docker-publish-amd64-job-66453518607-cancelled.log`):

| Time (UTC) | Event |
|---|---|
| 12:38:37 | Job starts on Azure westcentralus, Ubuntu 24.04, amd64 runner |
| 12:40:02 | Docker BuildKit container started |
| 12:40:06 | Step 1/13: Pull `konard/sandbox:1.3.16` base image (largest layer: 801.51 MB) |
| 12:41:58 | Base image pulled (~2 min) |
| 12:41:58 | Step 2/13: `usermod -l hive sandbox` (rename user) |
| 12:43:17 | Step 3/13: `apt-get install opam` (~1.5 min) |
| 12:43:35 | Steps 4-6/13: Fix paths, NVM paths, symlink (< 1 min total) |
| 12:43:35 | Step 8/13: `bun install -g` AI CLIs (claude-code, codex, etc.) |
| 12:43:47 | Step 9/13: `bun install -g` hive-mind utilities |
| 12:44:00 | Step 10/13: `npm install -g @playwright/mcp@latest` |
| 12:44:02 | Step 11/13: Install playwright browsers (Chrome, Firefox, WebKit, msedge, headless-shell) |
| 12:44:57 | Step 11/13 DONE (56s - downloading 6 browser binaries incl. msedge) |
| 12:45:26 | Step 12/13: `npx playwright install-deps` DONE |
| 12:45:27 | Step 13/13: `claude mcp add playwright` DONE (0.8s) |
| 12:45:27 | **Docker image build complete. Starting push to Docker Hub** |
| 12:51:24 | **Docker image successfully pushed to Docker Hub** (step #19 DONE, 357.3s) |
| 12:51:24 | **Step #21: Writing layers to GitHub Actions Cache** |
| 12:51:24–13:02:05 | Sequential cache layer writes: 605.62 MB in 51.5s, 801 MB in 72.1s, another layer in 129.9s, ... |
| 13:02:05 | Final layer `sha256:f89bc00...` starts writing to GHA cache |
| **13:08:38** | **`##[error]The operation was canceled.`** - Job cancelled |
| 13:09:16 | Cleanup complete, job ends |

**Total job time: 30 minutes 38 seconds** (against 30-minute timeout)

### Key Insight

The Docker image was **successfully built and pushed to Docker Hub** at 12:51:24, well before the 30-minute timeout. The cancellation happened 17 minutes later during the **GitHub Actions Cache layer export** phase. The job was writing the last of ~800 MB worth of cache layers sequentially when it was killed.

---

## Timeline Reconstruction (arm64 Build - Success)

| Time (UTC) | Event |
|---|---|
| 12:38:37 | Job starts on Azure southcentralus, arm64 runner (Ubuntu 24.04, by Arm Limited) |
| 12:39:10 | Pull `konard/sandbox:1.3.16` arm64 layers |
| 12:41:17 | Base image pulled (~2 min) |
| 12:41:17–12:46:07 | Build steps 2-10/13 (renaming user, opam, paths, tools) |
| 12:46:07 | Playwright browser install starts (arm64 skips Chrome+msedge - amd64 only) |
| 12:46:21 | Playwright DONE (14s - only 4 binaries, no msedge/chrome) |
| 12:47:26 | Docker image build complete |
| 12:47:26–13:07:19 | Push to Docker Hub + GHA cache export |
| 13:07:19 | **Job complete, image pushed successfully** |

**Total job time: 29 minutes** - completed within the 30-minute timeout, barely.

---

## Root Cause Analysis

### Root Cause 1: GHA Cache Export Sequential Write Bottleneck (PRIMARY)

The GitHub Actions cache backend (`type=gha`) with `mode=max` **exports all image layers sequentially** (not in parallel). For large images like hive-mind:

- The `konard/sandbox:1.3.16` base contributes a single ~801 MB layer
- Additional language/tool layers from sandbox (Python, Go, Rust, Java, PHP, etc.) add several hundred MB each
- With `mode=max`, ALL intermediate layers are exported, not just the final image layers
- Sequential write of ~2-3 GB of total cache data at ~10-30 MB/s = 100-300+ seconds

This is a documented upstream limitation in [moby/buildkit#2804](https://github.com/moby/buildkit/issues/2804). BuildKit does not parallelize writes to the GHA cache backend. Each layer must complete before the next begins, and GC pauses inside BuildKit can add tens of seconds between sequential writes.

### Root Cause 2: amd64 Image is Larger Than arm64 (CONTRIBUTING)

The amd64 image downloads 6 Playwright browser binaries (including Chrome full ~300 MB and msedge), while arm64 only downloads 4 (no msedge, no Chrome full). This makes:
- amd64 Playwright install: 56 seconds (vs 14s on arm64)
- amd64 total image size: significantly larger than arm64
- amd64 cache export time: proportionally longer

### Root Cause 3: 30-Minute Timeout is Too Tight (CONTRIBUTING)

The `timeout-minutes: 30` was appropriate for the arm64 build (29 minutes total), but insufficient for the amd64 build (which needs ~31-35 minutes end-to-end including cache export). A 5-minute buffer would prevent this class of cancellations.

### Root Cause 4: `mode=max` Exports More Data Than Necessary (CONTRIBUTING)

`cache-to: type=gha,mode=max` exports ALL intermediate build layers, including the full sandbox base image layers. Since the sandbox base (`konard/sandbox:1.3.16`) is a pinned, stable image, its layers will be identical on every build run. Caching them in GHA provides little benefit but adds significant export overhead.

`mode=min` would only export the final image layers that hive-mind adds on top of sandbox (AI tools, Playwright, etc.), which is much smaller than the full image.

---

## Why Docker Image Building Takes So Long After Switching to sandbox

Before the sandbox migration (issue #1394 PR #1396):
- Built from `ubuntu:24.04` (minimal base, ~30 MB)
- Ran full install script installing all tools from scratch
- Build time: 10-15 minutes per platform

After the sandbox migration:
- Pulls `konard/sandbox:1.3.16` (~2-3 GB pre-built image with all dev tools)
- Only installs AI-specific tools on top (fast: ~5 minutes)
- **But then exports 2-3 GB worth of layers to GHA cache sequentially**

The trade-off: faster Docker *build* time (no compiling from scratch), but slower CI *cache export* time (more layers to persist). The 30-minute job timeout was not updated to account for this.

---

## Online Research: Known Solutions

### Solution A: Add `ignore-error=true` to cache-to (RECOMMENDED - immediate)

```yaml
cache-to: type=gha,mode=min,scope=${{ matrix.platform }},ignore-error=true
```

Prevents the cache export from killing the job. If cache export times out, the build still succeeds (the image was already pushed to Docker Hub). The next run simply won't benefit from the cache.

- **Source:** [Docker GHA cache docs](https://docs.docker.com/build/cache/backends/gha/)
- **Impact:** Eliminates the cancellation failure with zero risk

### Solution B: Switch from `mode=max` to `mode=min` (RECOMMENDED - reduces data)

`mode=min` only exports the layers added by the current Dockerfile (the AI tools layer). The sandbox base layers are already stable and don't need to be cached per-run.

- Reduces cache export payload from ~2-3 GB to ~500-800 MB
- Proportionally reduces export time
- Still caches the most frequently-changed layers (the AI tool installs)

### Solution C: Increase `timeout-minutes` from 30 to 45 (RECOMMENDED - safety margin)

Provides headroom for:
- Slow network conditions
- GHA infrastructure congestion
- Slightly larger image versions

Arm64 completed in ~29 minutes; amd64 in ~32 minutes. 45 minutes gives comfortable margin for both.

### Solution D: Switch cache backend to Registry (LONG-TERM)

Using Docker Hub or GitHub Container Registry as the cache backend enables parallel layer export:

```yaml
cache-from: type=registry,ref=konard/hive-mind:buildcache-${{ matrix.platform }}
cache-to: type=registry,ref=konard/hive-mind:buildcache-${{ matrix.platform }},mode=max
```

- Exports are parallelized at the registry level (5 layers simultaneously by default)
- Not subject to the 10 GB per-repo GHA cache limit
- Eliminates sequential write bottleneck entirely
- Requires Docker Hub credentials (already available)
- **Source:** [Blacksmith's Docker Caching Guide](https://www.blacksmith.sh/blog/cache-is-king-a-guide-for-docker-layer-caching-in-github-actions)

### Solution E: Disable GHA cache entirely for sandbox-based images

Since the sandbox base image changes infrequently (pinned to a version tag), and the hive-mind-specific layers are fast to install (~5 minutes), the value of caching is reduced. A fresh pull of the sandbox base from Docker Hub may be faster than reading ~2 GB from GHA cache sequentially.

---

## Proposed Solutions (Prioritized)

### Immediate Fix (This PR)

Apply all three short-term solutions together:

1. **Increase `timeout-minutes` from 30 to 45** - gives adequate headroom for both amd64 and arm64
2. **Switch `mode=max` to `mode=min`** - reduces cache export payload significantly
3. **Add `ignore-error=true`** - prevents cache failures from killing successful builds

This is a minimal, safe, low-risk change that directly addresses the observed failure.

### Future Improvements (Follow-up Issues)

4. **Switch to registry cache backend** - eliminates the sequential write bottleneck entirely. Requires deciding between Docker Hub (`konard/hive-mind:buildcache-*`) and GHCR.
5. **Separate sandbox layers from hive-specific layers** - since sandbox is pinned, its layers never change. Only the AI tool layers need caching.
6. **Profile cache hit rate** - measure whether GHA cache is actually saving time on subsequent builds, given the sequential export overhead.

---

## Architecture Overview (Post-Migration)

```
konard/sandbox:1.3.16 (pinned)
    └── All general-purpose development tools (pre-built, ~2-3 GB)
        - Node.js (NVM), Bun, Deno, Python (pyenv), Go, Rust
        - Java (SDKMAN), PHP (Homebrew), Perl (Perlbrew)
        - Lean 4 (elan), Rocq/Coq (opam), .NET SDK 8.0
        - CMake, Clang, LLVM, LLD, GCC, Git, GitHub CLI
        - Kotlin, Ruby (rbenv), Swift, R, NASM, FASM

konard/hive-mind (this repo)
    └── FROM konard/sandbox:1.3.16
    └── sandbox user renamed to hive (backward compatibility)
    └── AI-specific tools added (~5 min install):
        - @anthropic-ai/claude-code, @openai/codex, @qwen-code/qwen-code
        - @google/gemini-cli, @github/copilot, opencode-ai
        - @link-assistant/hive-mind, @link-assistant/claude-profiles, @link-assistant/agent
        - start-command, gh-setup-git-identity, gh-pull-all, gh-load-*, gh-upload-log
        - Playwright + browsers (chromium, chrome[amd64], firefox, webkit, msedge[amd64]) + MCP
```

## References

- [Issue #1394](https://github.com/link-assistant/hive-mind/issues/1394) - Original optimization request
- [PR #1396](https://github.com/link-assistant/hive-mind/pull/1396) - Previous iteration: switched FROM ubuntu:24.04 to konard/sandbox
- [sandbox repository](https://github.com/link-foundation/sandbox)
- [sandbox PR #65](https://github.com/link-foundation/sandbox/pull/65) - Gap analysis and architecture clarification
- [CI Run #22902572178](https://github.com/link-assistant/hive-mind/actions/runs/22902572178) - The run showing the amd64 cancellation
- [amd64 Job #66453518607](https://github.com/link-assistant/hive-mind/actions/runs/22902572178/job/66453518607) - Cancelled job (GHA cache export timeout)
- [arm64 Job #66453518615](https://github.com/link-assistant/hive-mind/actions/runs/22902572178/job/66453518615) - Successful job
- [moby/buildkit#2804](https://github.com/moby/buildkit/issues/2804) - Root cause: GHA cache sequential write bottleneck
- [docker/build-push-action#975](https://github.com/docker/build-push-action/issues/975) - TLS handshake timeout on large GHA cache writes
- [Docker GHA cache backend docs](https://docs.docker.com/build/cache/backends/gha/) - `ignore-error`, `timeout`, `mode` parameters
- [Blacksmith Docker Caching Guide](https://www.blacksmith.sh/blog/cache-is-king-a-guide-for-docker-layer-caching-in-github-actions) - Registry cache vs GHA cache comparison
- [Historical ubuntu-24-server-install.sh](https://github.com/link-assistant/hive-mind/blob/4f027b32/scripts/ubuntu-24-server-install.sh) - Removed script, for reference
