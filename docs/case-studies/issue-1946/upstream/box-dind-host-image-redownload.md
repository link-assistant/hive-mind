# box-dind: nested daemon still re-downloads host images (~30 GB, ~1 hour) despite passthrough — continuation of #94 / #102

## Summary

When `solve`/`hive` runs inside `konard/hive-mind-dind:2.0.6` (docker-in-docker),
the nested Docker daemon starts with an **empty image store** and re-pulls the
multi-GB image that the **host already has**, instead of reusing it via
passthrough. On a recent run this cost ~30 GB of download and ~1 hour of
wall-clock before the actual task started.

This is the same defect tracked in #94 ("nested daemon starts with empty image
store, forcing re-download of host images") and #102 ("silent no-op when
`DIND_HOST_PASSTHROUGH_IMAGES` is set but no host socket is mounted"), both
closed, but the symptom still reproduces in production with box-dind 2.0.6.

## Environment

```
image: konard/hive-mind-dind:2.0.6
HIVE_MIND_IMAGE_VARIANT=dind
docker: 29.5.3
start-command: 0.29.1 (detached docker launch)
```

The dind entrypoint reports passthrough "complete", yet the image is still pulled
fresh:

```
[dind-entrypoint] Starting dockerd (storage-driver=fuse-overlayfs, data-root=/var/lib/docker)
[dind-entrypoint] dockerd is ready after 1s
[dind-entrypoint] image preload/passthrough complete   <-- claims complete…
```

…but the overall run still took ~54 minutes and consumed ~30 GB, consistent with
a full re-pull of the dind image inside the nested daemon.

## Reproduction

1. Launch a detached docker session using the dind variant on a host that already
   has `konard/hive-mind-dind:2.0.6` pulled.
2. Observe wall-clock (~1 hour) and disk delta (`df -h` before/after shows ~30 GB
   consumed inside the container's data-root).
3. Note the entrypoint prints `image preload/passthrough complete` even though no
   host image was actually copied into the nested store.

## Expected

The nested daemon should reuse the host's already-present image (via the
documented passthrough: host docker socket mount + `DIND_HOST_PASSTHROUGH_IMAGES`
allowlist), so no multi-GB re-download occurs and startup is seconds, not an hour.

## Workaround

Mount the host docker socket read-only and set the allowlist so passthrough can
actually copy the image:

```
docker run ... \
  -v /var/run/docker.sock:/var/run/host-docker.sock:ro \
  -e DIND_HOST_PASSTHROUGH_IMAGES=konard/hive-mind-dind:2.0.6 \
  konard/hive-mind-dind:2.0.6 ...
```

## Suggested fix (code level)

1. **Fail loudly, not silently** (re #102): if `DIND_HOST_PASSTHROUGH_IMAGES` is
   set but no host docker socket is mounted/reachable, the entrypoint must log a
   clear error and either abort or fall back to pull with an explicit warning —
   never print `image preload/passthrough complete` when nothing was copied.
2. **Verify the copy**: after passthrough, assert the allowlisted image is
   actually present in the nested daemon (`docker image inspect <name>`); if
   absent, surface it instead of proceeding to a silent re-pull.
3. **Document the required deployment wiring** (socket mount + allowlist) in the
   box-dind README and in the hive-mind deployment so operators get passthrough
   by default.

## References

- box #94 (empty nested image store → re-download) — closed, symptom persists.
- box #102 (silent passthrough no-op) — closed, symptom persists.
- Downstream report: link-assistant/hive-mind #1914 and #1946 (full case study
  with evidence and screenshots).

---

**Filed as:** https://github.com/link-foundation/box/issues/106
