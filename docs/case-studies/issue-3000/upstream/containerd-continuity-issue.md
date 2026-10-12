### Problem

`fs.DiskUsage` fails if a file under the root is deleted while it walks. On Unix it is a `filepath.Walk` whose callback returns the error it receives ([fs/du_unix.go#L68-L71](https://github.com/containerd/continuity/blob/555e512ce5c436ac0a05cdd516eff4ae5995ed15/fs/du_unix.go#L68-L71)):

```go
if err := filepath.Walk(root, func(path string, fi os.FileInfo, err error) error {
	if err != nil {
		return err
	}
```

`filepath.Walk` reads a directory and then `lstat`s each entry. If the entry is removed between those two calls, the callback gets `lstat …: no such file or directory` and the whole usage call fails. A directory removed between being listed and being read fails with `readdirent …: no such file or directory`.

That is the normal case for the main caller. The containerd overlay snapshotter computes `Usage` of an **active** snapshot (a running container's writable layer) with `fs.DiskUsage(ctx, upperPath)`, and running containers create and delete temp files all the time. In Docker (containerd image store), `docker ps --size`, `docker ps --format '{{json .}}'` and `docker system df` then fail:

```
Error response from daemon: snapshotter.Usage failed for db1ad9bf…: lstat /var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/25/fs/tmp/cc/f17: no such file or directory
Error response from daemon: snapshotter.Usage failed for db1ad9bf…: readdirent /var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/25/fs/tmp/cc: no such file or directory
```

### Reproduce

With Docker on the containerd image store (continuity v0.5.0 via containerd v2.4.1, Docker 29.9.0):

```bash
docker run -d --name churn alpine:3.20 sh -c 'while true; do mkdir -p /tmp/cc; for i in $(seq 300); do : > /tmp/cc/f$i; done; rm -rf /tmp/cc; done'
sleep 2
for i in $(seq 50); do docker ps -a --size >/dev/null 2>&1 || echo fail; done | wc -l   # 16 of 50 failed
docker rm -f churn
```

Without Docker: [this Go program](https://github.com/link-assistant/hive-mind/blob/issue-3000-919a1fead03b/experiments/issue-3000/du-walk-race/main.go) copies the `diskUsage` walk, runs it while a goroutine creates and removes 300 files in a subdirectory, and compares it with the fix below (Go 1.27.1, Linux 6.8, ext4):

```
continuity v0.5.0 walk:  failed 1060/2000 map[lstat <path>: no such file or directory:1050 readdirent <path>: no such file or directory:10]
skip-ENOENT walk:        failed 0/2000 map[]
missing root still fails: true
```

### Suggested fix

A disk-usage walk is a point-in-time estimate, so an entry that disappears mid-walk has no size to count. Skip it instead of failing:

```go
if err := filepath.Walk(root, func(path string, fi os.FileInfo, err error) error {
	if err != nil {
		if os.IsNotExist(err) && path != root {
			return nil // removed while walking; it no longer uses space
		}
		return err
	}
```

This also covers the directory case: when reading a directory fails, `filepath.Walk` passes that error to the callback for the directory, and returning `nil` skips the directory (the `readdirent` error is an `*os.PathError` wrapping ENOENT, so `os.IsNotExist` matches it). Keep failing if `root` itself is missing, so a wrong path is still reported.

[fs/du_windows.go](https://github.com/containerd/continuity/blob/555e512ce5c436ac0a05cdd516eff4ae5995ed15/fs/du_windows.go#L33-L36) has the same callback and needs the same change.

### Workarounds

Callers can avoid the walk when they don't need sizes: `docker ps` with explicit `--format` fields or `--size=false` (docker/cli#4067), or `GET /system/df?type=image` for image usage. A caller that needs the size can retry on ENOENT.

### Related

- moby/moby#MOBY_ISSUE: the docker daemon fails the whole container list on this error (the graphdriver store logs it and reports `-1`).
- The same error in other projects: ptone/scion#1867, ptone/scion#1864, openzim/zimfarm#1591, link-assistant/hive-mind#3000.
- containerd/nerdctl#3027: snapshotter `Usage` calls are expensive with many objects.
