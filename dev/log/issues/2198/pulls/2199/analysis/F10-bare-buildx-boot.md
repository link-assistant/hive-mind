# F10 — Eight Docker jobs boot BuildKit with no resilience

**Severity:** Medium · **Class:** Fragility (a transient outage fails a release)
**Status:** Fixed in `6501cdd3` by porting the template's composite action.

## Symptom

There is no failing run of *this* repository to point at, which is the honest framing:
this finding comes from the file-tree comparison against the template that the issue
explicitly asks for, not from a red log.

`release.yml` publishes **eight** Docker images per release, and all eight jobs booted
buildx identically:

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v4
```

## Why that is fragile

`docker/setup-buildx-action` bootstraps the `docker-container` driver, which pulls
`moby/buildkit:buildx-stable-1` from Docker Hub. A transient `registry-1.docker.io`
outage — or a rate-limit on an unauthenticated pull — therefore fails the publish before
a single layer is built, with an error that has nothing to do with the change being
released.

The template hit this and wrote a composite action for it
([js-ai-driven-development-pipeline-template#75](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/75),
with the upstream investigations in
[link-foundation/box#97](https://github.com/link-foundation/box/issues/97) and
[#100](https://github.com/link-foundation/box/issues/100)). hive-mind had **eight copies**
of the failure mode and no mitigation.

## Fix

`.github/actions/setup-buildx-resilient/`, ported from the template:

1. Pre-pull the pinned BuildKit image with bounded retries and exponential backoff.
2. On exhaustion, pull the same image from `mirror.gcr.io` — a pull-through cache on
   infrastructure independent of Docker Hub — and `docker tag` it back to the canonical
   reference, so the driver finds it locally under the name it expects.
3. If both fail, **warn and fall through**. `docker/setup-buildx-action` then runs
   exactly as it did before, so the worst case is unchanged rather than worse.
4. Then boot buildx with `driver-opts: image=<the pinned image>`.

Inputs: `buildkit-image`, `registry-mirror`, `verbose`. Tracing turns on with
`verbose: true` **or** `RUNNER_DEBUG=1`, so re-running a job with debug logging enabled
produces the trace without editing the workflow — which is the "add a verbose mode, keep
it off by default" requirement of this task, applied here.

## A bug the port introduced, caught by its own test

A local composite action (`uses: ./.github/actions/...`) is read from the **workspace**,
so `actions/checkout` must have run first. The four manifest-merge jobs checked out
*late* — they build nothing, and only needed the tree for
`scripts/create-manifest-list.sh`. Referencing the new action moved that requirement
earlier, so checkout moved to the top of those four jobs.

`tests/setup-buildx-resilient.test.mjs` asserts it: for every job that references the
composite action, a `uses: actions/checkout@` must appear earlier in the same job. The
assertion was verified to fail on the broken arrangement
(`not ok 2 - checks out before referencing the local composite action`) before the fix
was applied.

## Testing the action, not a copy of it

The test **extracts the pre-pull script out of `action.yml`** and runs it against a mock
`docker` on `PATH`, with `CANONICAL_OK` / `MIRROR_OK` fixtures driving the four cases
(canonical succeeds; canonical fails then mirror succeeds; both fail; retries exhaust).
Testing a transcribed copy of the script would pass forever after the real one drifted.

Two further assertions pin the repository-level property: no job boots
`docker/setup-buildx-action` directly, and the wrapper is used.
