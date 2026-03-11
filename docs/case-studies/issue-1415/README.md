# Case Study: Docker Build Performance Disparity Between amd64 and arm64 Architectures

**Issue:** [#1415](https://github.com/link-assistant/hive-mind/issues/1415)
**PR:** [#1416](https://github.com/link-assistant/hive-mind/pull/1416)
**Date:** 2026-03-11
**Status:** Fix Implemented - Switched to Registry Cache Backend

---

## Executive Summary

The Docker image publishing workflow experiences a **13x performance disparity** between amd64 (~2 minutes) and arm64 (~26 minutes) builds. This case study reconstructs the timeline, identifies root causes, and proposes solutions based on CI log analysis and online research.

**Key Finding:** The performance difference is primarily caused by **GitHub Actions Cache (GHA) export phase**, not the actual Docker image build. The arm64 build spends ~12 minutes exporting cache layers sequentially, while amd64 benefits from fully cached layers and completes in seconds.

---

## Problem Statement

From the referenced workflow run [#22957999603](https://github.com/link-assistant/hive-mind/actions/runs/22957999603):

| Platform | Build Time | Runner |
|----------|-----------|--------|
| linux/amd64 | ~2 minutes | ubuntu-latest |
| linux/arm64 | ~26 minutes | ubuntu-24.04-arm |

**Performance Ratio:** 13:1 (arm64 is 13x slower)

---

## Timeline Reconstruction

### Run #22957999603 (2026-03-11)

#### amd64 Build Timeline

| Time (UTC) | Event | Duration |
|------------|-------|----------|
| 14:42:51 | Job starts | - |
| 14:45:00 | Build steps #7-#18 all **CACHED** | instant |
| 14:45:01 | Exporting layers | instant |
| 14:45:05 | Push to Docker Hub complete | 3.8s |
| 14:45:05 | GHA cache export starts | - |
| 14:45:12 | GHA cache export complete | **7.2s** |
| 14:45:15 | Job complete | **~2m 24s total** |

**Key observation:** All Docker build steps were cached. Cache export took only 7.2 seconds.

#### arm64 Build Timeline

| Time (UTC) | Event | Duration |
|------------|-------|----------|
| 14:42:51 | Job starts | - |
| 14:43:22 | Build steps #7-#16 **CACHED** | instant |
| 14:43:22 | Step #17 ERROR: `blob sha256:b290c07... not found` | - |
| 14:43:23 | Step #18 ERROR: `blob sha256:3b737555... not found` | - |
| 14:50:35 | Step #18 restarts (playwright install-deps) | +7 min delay |
| 14:51:33 | Step #17 restarts (claude mcp add) | +8 min delay |
| 14:51:34 | Docker build complete | ~8.7 min |
| 14:55:36 | Exporting layers complete | **242.8s** |
| 14:56:29 | GHA cache export starts | - |
| 15:08:59 | GHA cache export complete | **750.8s** (~12.5 min) |
| 15:09:26 | Job complete | **~26m 35s total** |

**Key observation:** Cache misses on steps #17-#18 caused rebuilds, and GHA cache export took **12.5 minutes** (vs 7 seconds on amd64).

---

## Root Cause Analysis

### Primary Root Cause: Cache Miss on arm64 Layers

The arm64 build encountered cache blob errors:
```
#17 ERROR: blob sha256:b290c07173fb382ce5cda6d6f820913d90cc12aab79b56a5ef70c52f181fb324: not found
#18 ERROR: blob sha256:3b737555cadafbf290e3405c16a63eff2fc1bde635b13f940312129fe672fc47: not found
```

These errors indicate that the GHA cache for arm64 layers was either:
1. **Evicted** (GHA cache has a 10GB limit per repository)
2. **Corrupted** during a previous export
3. **Never successfully exported** due to timeout in a prior run

### Secondary Root Cause: GHA Cache Sequential Write Bottleneck

The GHA cache backend (`type=gha`) exports layers **sequentially**, not in parallel. This is a documented issue in [moby/buildkit#2804](https://github.com/moby/buildkit/issues/2804).

From the arm64 logs, the largest layers took:
- `sha256:425b1c25...`: **185.8s** (3+ minutes for one layer!)
- `sha256:c8765b1e...`: **155.9s** (2.5 minutes)
- `sha256:c739f5f1...`: **50.7s**
- `sha256:3a3a16b0...`: **44.6s**

Total cache export time: **750.8 seconds** (12.5 minutes)

### Contributing Factor: arm64 Image Layers Not Pre-Cached

Unlike amd64, the arm64 platform may have:
- Less frequent builds, leading to cache eviction
- Larger layers due to different base image content
- Network latency differences between Azure regions (westus for amd64 vs southcentralus for arm64)

### Contributing Factor: Layer Export Inefficiency

The workflow uses `cache-to: type=gha,mode=min,scope=${{ matrix.platform }}` which should export only final layers. However, the sandbox base image (`konard/sandbox:1.3.16`) contributes ~800MB of layers that must be written sequentially.

---

## Data Evidence

### Timing Breakdown Comparison

| Phase | amd64 | arm64 | Ratio |
|-------|-------|-------|-------|
| Docker build (cached) | <1s | 8m 42s | - |
| Layer export to registry | 3.8s | 242.8s | 64x |
| GHA cache export | 7.2s | 750.8s | **104x** |
| **Total** | 2m 24s | 26m 35s | **11x** |

### Layer Size Analysis

The arm64 cache export wrote 40+ layers, with several large ones:
- Multiple ~800MB layers from sandbox base
- ~486MB Playwright browsers layer
- ~80MB package layers

---

## Proposed Solutions

### Solution 1: Switch to Registry Cache Backend (RECOMMENDED)

Replace GHA cache with Docker Hub registry cache:

```yaml
cache-from: type=registry,ref=konard/hive-mind:buildcache-${{ matrix.platform == 'linux/amd64' && 'amd64' || 'arm64' }}
cache-to: type=registry,ref=konard/hive-mind:buildcache-${{ matrix.platform == 'linux/amd64' && 'amd64' || 'arm64' }},mode=max,image-manifest=true
```

**Benefits:**
- Registry exports are parallelized (vs sequential GHA)
- No 10GB cache limit
- Cross-workflow cache sharing
- Architecture-specific cache tags prevent overwriting

**Sources:**
- [Docker Registry Cache Docs](https://docs.docker.com/build/cache/backends/registry/)
- [Blacksmith: Cache is King](https://www.blacksmith.sh/blog/cache-is-king-a-guide-for-docker-layer-caching-in-github-actions)

### Solution 2: Add `ignore-error=true` to Cache Export (IMMEDIATE FIX)

Prevent cache export failures from blocking successful builds:

```yaml
cache-to: type=gha,mode=min,scope=${{ matrix.platform }},ignore-error=true
```

**Benefits:**
- If cache export times out, the build still succeeds
- The image is already pushed to Docker Hub before cache export starts
- Simple, low-risk change

### Solution 3: Increase Timeout to 60 Minutes (SAFETY MARGIN)

The current 45-minute timeout may not be sufficient for arm64 builds under adverse conditions.

```yaml
timeout-minutes: 60
```

### Solution 4: Pre-warm arm64 Cache on Schedule

Run a weekly scheduled workflow to build and cache the arm64 image:

```yaml
on:
  schedule:
    - cron: '0 0 * * 0'  # Every Sunday at midnight
```

This ensures the arm64 cache is always warm, reducing build times on release days.

### Solution 5: Use Larger arm64 Runners (FUTURE)

GitHub now offers larger Arm-hosted runners (4-core, 8-core) that may have faster network and disk I/O for cache operations.

---

## Implementation (This PR #1416)

### Changes Made

1. **Switched from GHA cache to registry cache backend** - Uses Docker Hub registry for cache storage
2. **Architecture-specific cache tags** - `buildcache-amd64` and `buildcache-arm64` prevent cross-platform overwrites
3. **Increased timeout from 45 to 60 minutes** - Safety margin for cache miss scenarios
4. **Added `ignore-error=true`** - Ensures builds succeed even if cache export fails
5. **Documentation** - Created comprehensive case study with timeline and root cause analysis

### Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| arm64 worst case (cache miss) | 26+ min | ~10-15 min (parallel export) |
| arm64 best case (cache hit) | ~5 min | ~3-5 min |
| amd64 | ~2 min | ~2 min |
| Build reliability | Medium | High |

### Future Improvements

1. Monitor cache hit rates after this change
2. Consider scheduled cache warming workflow
3. Evaluate larger ARM64 runners if needed

---

## Online Research Sources

- [moby/buildkit#2804](https://github.com/moby/buildkit/issues/2804) - GHA cache sequential write bottleneck (root cause)
- [docker/build-push-action#545](https://github.com/docker/build-push-action/issues/545) - Cache export takes ~300s
- [Blacksmith: Building Multi-Platform Docker Images](https://www.blacksmith.sh/blog/building-multi-platform-docker-images-for-arm64-in-github-actions)
- [Docker Cache Backends Documentation](https://docs.docker.com/build/cache/backends/)
- [Optimizing Multi-Platform Docker Builds](https://packagemain.tech/p/optimizing-multi-platform-docker)
- [GitHub Blog: Arm64 Runners](https://github.blog/news-insights/product-news/arm64-on-github-actions-powering-faster-more-efficient-build-systems/)

---

## Related Case Studies

- [Issue #998: Docker Publish arm64 Stuck](../issue-998/README.md) - Homebrew bottle download slowness
- [Issue #1394: Docker Build Optimization with sandbox](../issue-1394/CASE-STUDY.md) - GHA cache export timeout

---

## Appendix: Raw CI Logs

The full CI logs are saved in:
- `ci-logs/release-22957999603.log` - Complete workflow run

### Key Log Excerpts

**arm64 Cache Miss Error:**
```
#17 [13/13] RUN if command -v claude &>/dev/null; then ...
#17 ERROR: blob sha256:b290c07173fb382ce5cda6d6f820913d90cc12aab79b56a5ef70c52f181fb324: not found
```

**arm64 Cache Export Duration:**
```
#21 exporting to GitHub Actions Cache
#21 preparing build cache for export 750.8s done
#21 DONE 750.8s
```

**amd64 Cache Export Duration (for comparison):**
```
#21 exporting to GitHub Actions Cache
#21 preparing build cache for export 7.2s done
#21 DONE 7.2s
```
