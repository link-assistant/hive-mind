# `docker inspect --size` can hang indefinitely with fuse-overlayfs while regular inspect succeeds

## Description

On a Linux Docker Engine using the `fuse-overlayfs` storage driver, requesting a running container's size can remain blocked indefinitely while ordinary inspection, logs, wait, and container lifecycle operations remain responsive. I first observed this in an orchestration launch path: the size is an optional baseline metric, but the blocked request held the entire launch lifecycle open.

The behavior is reproducible with a public, immutable image. In repeated tests, a plain `docker inspect` returned immediately, while `docker inspect --size` had not returned after ten seconds and remained blocked after the container exited. In the first observation I stopped the client after more than three minutes.

## Reproducible example

```bash
image='docker.io/konard/hive-mind-dind@sha256:b5e71481abcc540a881d805007051211c09661911379f40e248fa4bd064fe6d7'
name='moby-inspect-size-fuse-repro'
gate='/tmp/moby-inspect-size-gate'

docker run -d --privileged \
  --name "$name" \
  -e DIND_STORAGE_DRIVER=fuse-overlayfs \
  "$image" \
  sh -c 'gate='"'"$gate"'"'; while [ ! -e "$gate" ]; do sleep 0.1; done'

# Returns immediately and reports State.Running=true.
docker inspect -f '{{.State.Running}}' "$name"

# Does not return. In a second terminal, ordinary inspect/logs remain responsive.
docker inspect --size -f '{{.SizeRw}}' "$name"

# Cleanup after interrupting the blocked client.
docker rm -f "$name"
```

The image is approximately 19.7 GB extracted. Its entrypoint starts a nested daemon whose data root is in the outer container's writable layer; that is a realistic Docker-in-Docker workload and makes the size walk non-trivial.

## Actual result

`GET /containers/{id}/json?size=1`, as invoked by `docker inspect --size`, does not complete. The client can stay blocked indefinitely. Regular inspection without `size=1` and other daemon operations continue to work.

## Expected result

The size-enabled inspection should complete, fail with an actionable error, or honor cancellation promptly. An expensive best-effort size calculation should not leave a client blocked indefinitely.

## Environment

- Docker Engine and CLI: 29.6.0, API 1.55
- containerd: v2.2.5
- runc: 1.3.6
- Host: Ubuntu 24.04.4 LTS, kernel 6.8.0-139-generic, x86_64
- Storage driver: `fuse-overlayfs`
- Cgroup: v2 with `cgroupfs`
- Reproduction image ID: `sha256:bbe65ca0080b1ba610dbcf4a73dd430468d1b04865e5f9a514a51554b89caed9`

## Workaround

Treat `SizeRw` as an optional metric and put a client-side deadline around the request. The affected caller now invokes the Docker CLI with a ten-second process timeout, returns an unavailable metric on timeout, and continues the launch. Omitting `--size` also avoids the problem.

## Suggested code direction

Please propagate HTTP request cancellation through the storage-driver writable-layer size walk and ensure the daemon-side calculation cannot wait forever. A bounded or cancellable implementation would let clients abandon expensive size collection without leaking a long-running request. It may also be useful to document that `size=1` can require an expensive writable-layer traversal.

This was found while investigating link-assistant/hive-mind#2244. The exact harness and captured before/after evidence are being preserved in that repository.
