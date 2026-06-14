---
'@link-assistant/hive-mind': patch
---

fix(isolation): default nested Docker daemon to fuse-overlayfs so multi-GB images fit on disk + add storage-driver/disk preflight diagnostics (#1914)

`--isolation docker` was reopened after PR #1915: native Docker isolation and
host-image passthrough now work, but the first isolated task on the >30 GB
`konard/hive-mind-dind` image still died with:

```
failed to register layer: no space left on device
```

even though most layers reported `Already exists` (the daemon was correctly
seeded — passthrough is working). The failure was during layer **registration**,
not download.

**Root cause (in this repo).** `Dockerfile.dind` baked `ENV
DIND_STORAGE_DRIVER="vfs"` (commit 44d2c29e). `vfs` performs **no copy-on-write**:
it materializes a full, independent copy of the entire filesystem for *every*
layer, so a multi-GB image's on-disk footprint becomes the *sum* of all
cumulative layer sizes — many times the image size — and overflows the disk.
Worse, pinning the env var **defeated box-dind's storage-driver auto-detection**
(`overlay2 → fuse-overlayfs → vfs`, with graceful fallback): box would otherwise
have picked a copy-on-write driver here. `/dev/fuse` is present (the dind
container runs `--privileged`), the `fuse-overlayfs` binary ships in box-dind,
and `overlay` is in `/proc/filesystems` — so copy-on-write was available the
whole time but was being bypassed by the `vfs` pin.

**Fix.** `Dockerfile.dind` now pins `ENV DIND_STORAGE_DRIVER="fuse-overlayfs"` — a
copy-on-write driver that also works overlay-on-overlay (the compatibility reason
`vfs` was originally chosen; `overlay2` can fail on the overlay-backed hosts our
deploys run on). Under `fuse-overlayfs`, registering a 498 MB top layer on a
~30 GB base costs ~498 MB instead of ~30 GB, so the image fits. Empirically
verified in the box-dind environment (`docs/case-studies/issue-1914/data/fuse-overlayfs-capability-proof.log`).

**Self-diagnosing preflight.** `src/isolation-runner.lib.mjs` gained two probes —
`checkDockerStorageDriver()` and `checkDockerDiskSpace()` — wired into
`preflightDockerIsolation()`. Before running an isolated task it now warns, with
an actionable remedy, when the nested daemon is on `vfs` (even if the image is
already present) or when free space at the Docker data root is below 40 GiB, so
the next operator hitting this gets a clear breadcrumb instead of a cryptic
`no space left on device`. Both probes are best-effort and never throw.

Added `tests/test-issue-1914-storage-driver-diagnostics.mjs` (34 assertions),
extended `tests/test-issue-1914-preflight-passthrough.mjs` and
`tests/test-docker-dind-variant.mjs`, refreshed `docs/DOCKER*.md`, and expanded
the `docs/case-studies/issue-1914` case study with the reopen timeline, refined
root-cause analysis, captured evidence, and an upstream observability request
(link-foundation/box#104: warn when the nested daemon lands on `vfs`).
