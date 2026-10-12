### Description

With the containerd image store, `GET /containers/json?size=1` (`docker ps --size`, and `docker ps --format '{{json .}}'`, which asks for sizes automatically) and `GET /system/df` fail **for the whole request** if one running container deletes a file while dockerd walks that container's writable layer:

```
Error response from daemon: snapshotter.Usage failed for db1ad9bf…: lstat /var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/25/fs/tmp/cc/f17: no such file or directory
Error response from daemon: failed to retrieve container list: snapshotter.Usage failed for db1ad9bf…: lstat …/snapshots/25/fs/tmp/cc/f17: no such file or directory
```

Any container that writes temp files (a compiler, a test runner, a package manager) is enough to trigger it. One busy container fails the listing of **every** container, so tools that list containers see either an error or, if they treat errors as "nothing there", an empty host.

The race is in the walk itself. For an active snapshot, the overlay snapshotter's `Usage` calls `fs.DiskUsage` (containerd/continuity), a `filepath.Walk` that returns the first error it gets, including ENOENT for a file removed between `readdir` and `lstat` ([du_unix.go#L68-L71](https://github.com/containerd/continuity/blob/555e512ce5c436ac0a05cdd516eff4ae5995ed15/fs/du_unix.go#L68-L71)).

Dockerd then turns that error into a list failure:

- [`GetContainerLayerSize`](https://github.com/moby/moby/blob/9fabd6dfbb926381278c436a866bc8d6ac222274/daemon/containerd/service.go#L336-L367) returns `errdefs.System(… "snapshotter.Usage failed for %s")`.
- The per-container worker in [`daemon/list.go`](https://github.com/moby/moby/blob/9fabd6dfbb926381278c436a866bc8d6ac222274/daemon/list.go#L163-L170) returns that error to the errgroup, and `g.Wait()` fails the whole list.
- [`daemon/disk_usage.go`](https://github.com/moby/moby/blob/9fabd6dfbb926381278c436a866bc8d6ac222274/daemon/disk_usage.go#L17-L23) lists containers with `Size: true`, so `docker system df` fails the same way ("failed to retrieve container list: …").

The graphdriver image service does not fail here: [`daemon/images/image_unix.go`](https://github.com/moby/moby/blob/9fabd6dfbb926381278c436a866bc8d6ac222274/daemon/images/image_unix.go#L19-L50) logs the error, reports `-1` and lists the container anyway. With the containerd store now the default for fresh installs (29.0.0), more hosts hit the strict path.

moby/moby#52090 fixed the same pattern for `docker system prune` ("Don't fail early on layer size errors"). The list and `system df` paths still fail.

### Reproduce

Containerd image store (`Storage Driver: overlayfs`, `driver-type: io.containerd.snapshotter.v1`):

```bash
docker run -d --name churn alpine:3.20 sh -c 'while true; do mkdir -p /tmp/cc; for i in $(seq 300); do : > /tmp/cc/f$i; done; rm -rf /tmp/cc; done'
sleep 2
for i in $(seq 50); do docker ps -a --size >/dev/null 2>&1 || echo fail; done | wc -l
for i in $(seq 50); do docker system df >/dev/null 2>&1 || echo fail; done | wc -l
for i in $(seq 50); do curl -s -o /dev/null -w '%{http_code}\n' --unix-socket /var/run/docker.sock 'http://localhost/v1.47/containers/json?all=1&size=1'; done | sort | uniq -c
docker rm -f churn
```

Output on Docker 29.9.0:

```
docker ps -a --size          failed 16/50
docker ps -a --format '{{json .}}' failed 11/50
docker ps -a                 failed 0/50
docker system df             failed 13/50
# GET /containers/json?all=1&size=1 status codes:
     37 200
     13 500
# daemon errors:
     13 Error response from daemon: failed to retrieve container list: snapshotter.Usage failed for db1ad9bf…: lstat /var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/25/fs/tmp/cc/fN: no such file or directory
     26 Error response from daemon: snapshotter.Usage failed for db1ad9bf…: lstat /var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/25/fs/tmp/cc/fN: no such file or directory
      1 Error response from daemon: snapshotter.Usage failed for db1ad9bf…: readdirent /var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/25/fs/tmp/cc: no such file or directory
```

The same script with more containers and timings: [minimal-upstream-repro.sh](https://github.com/link-assistant/hive-mind/blob/issue-3000-919a1fead03b/experiments/issue-3000/minimal-upstream-repro.sh), [reproduce-size-walk.sh](https://github.com/link-assistant/hive-mind/blob/issue-3000-919a1fead03b/experiments/issue-3000/reproduce-size-walk.sh).

### Expected behavior

A size that cannot be computed for one container does not fail the request. The container is listed with `SizeRw`/`SizeRootFs` unset (or `-1`, as the graphdriver path reports), the error is logged, and `docker system df` still reports the other objects. That is what the graphdriver store does, and what #52090 did for prune.

### docker version

```
Client: Docker Engine - Community
 Version:           29.8.2
 API version:       1.56
Server: Docker Engine - Community
 Engine:
  Version:          29.9.0
  API version:      1.56 (minimum version 1.40)
  Go version:       go1.26.9
  Git commit:       a5b58c9
 containerd:
  Version:          v2.4.1
 runc:
  Version:          1.5.2
```

### docker info

```
Server Version: 29.9.0
Storage Driver: overlayfs
 driver-type: io.containerd.snapshotter.v1
Cgroup Driver: cgroupfs
Cgroup Version: 2
```

(Reproduced in a `docker:dind` container with `/var/lib/docker` on tmpfs. The same error was seen on a production host running Docker 29.6.1 on the containerd store.)

### Additional Info

**Suggested fix (moby):** in `daemon/list.go`, treat a `GetContainerLayerSize` error like the graphdriver path does: log it at warn/debug, leave the sizes unset or `-1`, and keep the container. `daemon/disk_usage.go` then works too. Optionally, retry the walk once on ENOENT before giving up.

**Suggested fix (containerd/continuity):** make `fs.DiskUsage` skip entries that vanish mid-walk (`os.IsNotExist(err)` → `return nil`; for a directory, `filepath.SkipDir`). The size is a point-in-time estimate anyway. Reported as containerd/continuity#CONTINUITY_ISSUE.

**Workarounds for callers:**

- Do not request sizes: use `docker ps --format` with explicit fields (`{"ID":{{json .ID}},"Names":{{json .Names}},…}`) instead of `{{json .}}`, or add `--size=false` (honoured since docker/cli#4067; older CLIs ignore it).
- For image disk usage, call the API with `GET /system/df?type=image` (API ≥ 1.42). The `docker system df` CLI has no type flag, so it always computes container sizes.
- Treat a failed listing as "unknown", never as "no containers".

**Related:** docker/for-linux#1179 (`{{json .}}` slow because of `.Size`); moby/moby#52012 / #52090 (same pattern on prune); moby/moby#47581 / #49365 (parallel size computation); reports of the same error in other projects: ptone/scion#1867, ptone/scion#1864, openzim/zimfarm#1591, link-assistant/hive-mind#3000.
