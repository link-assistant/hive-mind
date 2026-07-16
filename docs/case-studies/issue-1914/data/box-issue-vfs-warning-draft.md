## Summary

When the nested Docker daemon ends up on the **`vfs`** storage driver, large
images can fail to pull/run with a cryptic `failed to register layer: no space
left on device`, with **no hint** that the storage driver is the cause. `vfs`
performs **no copy-on-write** — it stores a full, independent copy of the entire
filesystem for _every_ layer — so a multi‑GB image's on‑disk footprint becomes
the _sum of all cumulative layer sizes_, many times the image size. A ~30 GB
image can overflow a disk that has far more than 30 GB free.

`box-dind` already auto-detects a good driver (`overlay2 → fuse-overlayfs → vfs`,
with graceful fallback), and `vfs` is only the last resort — so this is **not** a
"wrong default" bug. The request is **observability**: when the daemon actually
runs on `vfs`, emit a one-line `warn` explaining the copy-on-write/disk
implication and the fix. Today the choice is silent (only a `log` line names the
driver), so an operator hitting `no space left on device` has no breadcrumb.

This bit us downstream in link-assistant/hive-mind#1914: a >30 GB image's
isolated task failed with `failed to register layer: no space left on device`
even though most layers were already present, and it took a deep investigation to
trace it to `vfs`.

## How `box-dind` can land on `vfs`

1. **Explicit pin** — a downstream image/`docker run` sets
   `DIND_STORAGE_DRIVER=vfs` (e.g. for overlay-on-overlay compatibility), which
   makes `storage_driver_candidates()` return only `vfs`. _(This was our case.)_
2. **Last-resort fallback** — auto-detect tries `overlay2`, then `fuse-overlayfs`,
   and falls through to `vfs` if neither becomes ready (e.g. `/dev/fuse` missing
   and overlay-on-overlay unsupported).

In both paths the operator is never told that the active driver has no
copy-on-write and will amplify large images on disk.

## Reproduction

```bash
# A box-dind daemon forced onto vfs (mirrors the explicit-pin path):
docker run --rm -it --privileged \
  -e DIND_STORAGE_DRIVER=vfs \
  konard/box-dind:2.3.2 bash -lc '
    docker info --format "driver={{.Driver}}"      # => driver=vfs   (no warning emitted)
    df -h /var/lib/docker
    docker pull <some multi-GB image>              # registers layers as full copies
    # On a >30 GB image this eventually prints:
    #   failed to register layer: no space left on device
  '
```

`docker info` confirms `Storage Driver: vfs` and `df` shows the data root filling
far faster than the image's nominal size — but `box-dind` itself prints nothing
about it.

## Why it matters

- `vfs` footprint = Σ(cumulative layer size). For an image with N layers totaling
  S, the on-disk cost is roughly `N × (average prefix of S)` — for multi-GB images
  this is many times S. Registering even a small top layer requires copying the
  entire base again.
- The failure surfaces as a generic disk error during `docker pull`/`docker run`,
  with no pointer to the storage driver, so it's easily misdiagnosed as "not
  enough disk" rather than "wrong driver wastes the disk."

## Workaround (works today)

Pin a copy-on-write driver that also works overlay-on-overlay:

```bash
docker run --rm -it --privileged \
  -e DIND_STORAGE_DRIVER=fuse-overlayfs \
  konard/box-dind:2.3.2 ...
```

`fuse-overlayfs` is copy-on-write **and** works overlay-on-overlay (the
compatibility reason `vfs` is sometimes chosen). `box-dind` already ships the
`fuse-overlayfs` binary, and `--privileged` provides `/dev/fuse`. Verified: under
`fuse-overlayfs`, registering a 498 MB layer on a ~30 GB base costs ~498 MB
instead of ~30 GB, so the image fits.

## Suggested fix (code)

Emit a `warn` whenever the **active** driver is `vfs`, right after the daemon
becomes ready, in `ubuntu/24.04/dind/dind-entrypoint.sh`'s `start_dockerd()`
success branch:

```sh
    if wait_for_dockerd_ready "$DIND_DOCKERD_PID" "$DIND_STORAGE_DRIVER"; then
+     if [ "$DIND_STORAGE_DRIVER" = "vfs" ]; then
+       warn "dockerd is using the 'vfs' storage driver, which has NO copy-on-write:"
+       warn "every image layer is stored as a full copy, so multi-GB images consume"
+       warn "many times their size on disk and 'docker pull'/'docker run' can fail with"
+       warn "'failed to register layer: no space left on device'. If your host supports"
+       warn "it, set DIND_STORAGE_DRIVER=fuse-overlayfs (copy-on-write, works"
+       warn "overlay-on-overlay; needs /dev/fuse via --privileged)."
+     fi
      return 0
    fi
```

Optional niceties:

- In the auto-detect fallback path, when `vfs` is selected _because_ `overlay2`
  and `fuse-overlayfs` both failed, include the reason (e.g. "fuse-overlayfs
  unavailable: /dev/fuse missing — run with --privileged or --device /dev/fuse").
- Mention in the `DIND_STORAGE_DRIVER` doc comment (currently
  "default: auto-detected: overlay2, fuse-overlayfs, vfs") that `vfs` has no
  copy-on-write and is disk-hungry for large images.

This keeps the safe `vfs` fallback while turning a silent footgun into an
actionable one-liner.

---

_Filed from link-assistant/hive-mind#1914, where pinning
`DIND_STORAGE_DRIVER=fuse-overlayfs` resolved `failed to register layer: no space
left on device` on a >30 GB image._
