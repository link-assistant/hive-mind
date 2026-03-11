# Proposed Solutions for Docker Build Performance Issue #1415

## Solution Priority Matrix

| Priority | Solution | Impact | Effort | Risk |
|----------|----------|--------|--------|------|
| 1 | Add `ignore-error=true` | High | Low | None |
| 2 | Switch to Registry Cache | High | Medium | Low |
| 3 | Increase timeout to 60min | Medium | Low | None |
| 4 | Pre-warm arm64 cache | Medium | Medium | Low |
| 5 | Larger arm64 runners | Low | High | Medium |

---

## Solution 1: Add `ignore-error=true` to Cache Export

**Status:** RECOMMENDED - Immediate implementation

### Current Configuration
```yaml
cache-to: type=gha,mode=min,scope=${{ matrix.platform }}
```

### Proposed Configuration
```yaml
cache-to: type=gha,mode=min,scope=${{ matrix.platform }},ignore-error=true
```

### Rationale
- The Docker image is successfully pushed BEFORE cache export starts
- If cache export fails/times out, the build still succeeds
- Users get the published image regardless of cache status
- Next build may not benefit from cache, but at least the current build succeeds

### References
- [Docker GHA Cache Docs](https://docs.docker.com/build/cache/backends/gha/)

---

## Solution 2: Switch to Registry Cache Backend

**Status:** RECOMMENDED - Short-term implementation

### Current Configuration
```yaml
cache-from: type=gha,scope=${{ matrix.platform }}
cache-to: type=gha,mode=min,scope=${{ matrix.platform }},ignore-error=true
```

### Proposed Configuration
```yaml
cache-from: type=registry,ref=konard/hive-mind:buildcache-${{ matrix.platform == 'linux/amd64' && 'amd64' || 'arm64' }}
cache-to: type=registry,ref=konard/hive-mind:buildcache-${{ matrix.platform == 'linux/amd64' && 'amd64' || 'arm64' }},mode=max,image-manifest=true
```

### Benefits Over GHA Cache

| Feature | GHA Cache | Registry Cache |
|---------|-----------|----------------|
| Export parallelism | Sequential | Parallel |
| Storage limit | 10GB per repo | Unlimited |
| Cross-workflow sharing | Same workflow only | Any workflow |
| Export speed | Slow (sequential API) | Fast (parallel push) |

### Architecture-Specific Tags
Using separate cache tags (`buildcache-amd64`, `buildcache-arm64`) prevents one platform's cache from overwriting another. This is crucial for multiplatform builds.

### Implementation Steps
1. Update `cache-from` to reference registry
2. Update `cache-to` to push to registry with `mode=max`
3. Verify Docker Hub credentials are available in secrets
4. Test with a single platform first

### References
- [Docker Registry Cache Docs](https://docs.docker.com/build/cache/backends/registry/)
- [Blacksmith: Cache is King](https://www.blacksmith.sh/blog/cache-is-king-a-guide-for-docker-layer-caching-in-github-actions)
- [docker/buildx#1044](https://github.com/docker/buildx/issues/1044) - Multi-platform cache overwriting issue

---

## Solution 3: Increase Timeout to 60 Minutes

**Status:** RECOMMENDED - Safety margin

### Current Configuration
```yaml
timeout-minutes: 45
```

### Proposed Configuration
```yaml
timeout-minutes: 60
```

### Rationale
- arm64 build took 26 minutes in this run
- Under adverse conditions (cache miss, slow network), could take longer
- 60-minute timeout provides ~2x headroom
- Docker image successfully pushed within first 15 minutes regardless

---

## Solution 4: Pre-warm arm64 Cache on Schedule

**Status:** OPTIONAL - Medium-term optimization

### Implementation
Add a scheduled workflow to build the arm64 image weekly:

```yaml
name: Pre-warm Docker Cache

on:
  schedule:
    - cron: '0 0 * * 0'  # Every Sunday at midnight UTC

jobs:
  warm-cache:
    runs-on: ubuntu-24.04-arm
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build (cache only, no push)
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/arm64
          push: false
          cache-from: type=gha,scope=linux/arm64
          cache-to: type=gha,mode=min,scope=linux/arm64,ignore-error=true
```

### Benefits
- Ensures arm64 cache is always warm
- Reduces build time on release days
- Catches base image updates early

---

## Solution 5: Larger arm64 Runners

**Status:** FUTURE - Evaluation needed

GitHub offers larger Arm-hosted runners with more CPU and memory:
- 4-core arm64
- 8-core arm64

These may have:
- Faster network throughput
- Faster disk I/O
- Reduced cache export time

### Cost Consideration
Larger runners cost more per minute. Need to evaluate if the time savings justify the cost increase.

---

## Implementation Plan

### Phase 1: Implemented (PR #1416)
1. [x] Create case study documentation
2. [x] Switch to registry cache backend (combined from Phase 2)
3. [x] Use architecture-specific cache tags (`buildcache-amd64`, `buildcache-arm64`)
4. [x] Add `ignore-error=true` to cache-to
5. [x] Increase timeout to 60 minutes
6. [ ] Test with next release

### Phase 2: Long-term (Evaluation)
1. [ ] Monitor cache hit rates
2. [ ] Evaluate pre-warm workflow if needed
3. [ ] Consider larger runners if needed

---

## Expected Impact

| Metric | Before | After (Phase 1) | After (Phase 2) |
|--------|--------|-----------------|-----------------|
| arm64 worst case | 26+ min | 26 min (no failure) | ~5-10 min |
| arm64 cache hit | ~5 min | ~5 min | ~3-5 min |
| amd64 | ~2 min | ~2 min | ~2 min |
| Build reliability | Medium | High | High |

---

## References

### Internal
- [Issue #998 Case Study](../issue-998/README.md) - Previous arm64 slowness
- [Issue #1394 Case Study](../issue-1394/CASE-STUDY.md) - GHA cache timeout

### External
- [moby/buildkit#2804](https://github.com/moby/buildkit/issues/2804) - GHA cache sequential write issue
- [Docker Cache Backends](https://docs.docker.com/build/cache/backends/)
- [GitHub ARM64 Runners](https://github.blog/news-insights/product-news/arm64-on-github-actions-powering-faster-more-efficient-build-systems/)
