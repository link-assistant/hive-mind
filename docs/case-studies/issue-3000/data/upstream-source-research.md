# Docker research notes: ps/df/image-ls sizes (2026-10-12)

Pinned refs:

- docker/cli master = e4078058de0a9f4d5cb65f946f4b8a090e19fffe (CLI)
- moby/moby master = 9fabd6dfbb926381278c436a866bc8d6ac222274 (daemon); cross-checked on tags docker-v29.0.0 and docker-v29.9.0

CLI = https://github.com/docker/cli/blob/e4078058de0a9f4d5cb65f946f4b8a090e19fffe
MOBY = https://github.com/moby/moby/blob/9fabd6dfbb926381278c436a866bc8d6ac222274

## 1. `docker ps --format` -> size=1 auto-detection (docker/cli)

CLI/cli/command/container/list.go#L71-L115 (`buildContainerListOptions`):

```go
	// always validate template when `--format` is used, for consistency
	if len(options.format) > 0 {
		tmpl, err := templates.Parse(options.format)
		...
		optionsProcessor := formatter.NewContainerContext()
		...
		if err := tmpl.Execute(io.Discard, optionsProcessor); err != nil {
		...
		// if `size` was not explicitly set to false (with `--size=false`)
		// and `--quiet` is not set, request size if the template requires it
		if !options.quiet && !listOptions.Size && !options.sizeChanged {
			// The --size option isn't set, but .Size may be used in the template.
			// Parse and execute the given template to detect if the .Size field is
			// used. If it is, then automatically enable the --size option. See #24696
			//
			// Only requesting container size information when needed is an optimization,
			// because calculating the size is a costly operation.

			if _, ok := optionsProcessor.FieldsUsed["Size"]; ok {
				listOptions.Size = true
			}
		}
	}
```

`sizeChanged` is set at L39: `options.sizeChanged = cmd.Flags().Changed("size")`.

CLI/cli/command/formatter/container.go#L100-L104 (struct field) and #L273-L278 (Size accessor):

```go
	// FieldsUsed is used in the pre-processing step to detect which fields are
	// used in the template. It's currently only used to detect use of the .Size
	// field which (if used) automatically sets the '--size' option when making
	// the API call.
	FieldsUsed map[string]any
...
func (c *ContainerContext) Size() string {
	if c.FieldsUsed == nil {
		c.FieldsUsed = map[string]any{}
	}
	c.FieldsUsed["Size"] = struct{}{}
```

container.go#L131-L133: `func (c *ContainerContext) MarshalJSON() ([]byte, error) { return MarshalJSON(c) }`

Why `{{json .}}` triggers it: `json` template func = `formatJSON` (CLI/templates/templates.go#L19, #L91-L102) -> `json.NewEncoder(buf).Encode(v)` -> ContainerContext.MarshalJSON -> CLI/cli/command/formatter/reflect.go#L25-L71 `marshalMap` loops `for i := 0; i < val.NumMethod(); i++` and `val.Call(...)` on EVERY exported zero-arg/one-result method (only "FullHeader" blacklisted). So Size() is invoked during the pre-processing execution -> FieldsUsed["Size"] set -> `size=1` sent.

History:

- moby/moby#21991 issue; moby/moby#22033 -> carried as moby/moby#23247 "Add a check for size field in custom format string" (merged 2016-06-05) — original auto-detection ("parser ... to determine if `.Size` was called ... reworked by making use of template execution with a pre-processor struct that will set the `--size` option").
- moby/moby#24696 "calling docker ps with size in format is confusing" fixed by moby/moby#24703 (merged 2016-08-05) "Fixes Size showing 0 in formatted ps output" (pre-processor failed early on non-Size fields).
- docker/cli#2232 "Fix some issues with docker ps --format" (commit 69f216f6, 2019-12-24, thaJeztah) — introduced current `FieldsUsed` + reuse of real ContainerContext so funcs like `json`/`upper` work in preprocessing (this is what made `{{json .}}` reliably call Size()).
- docker/cli#4067 "Don't automatically request size if `--size` was explicitly set to `false`" (merged 2023-03-06, laurazard): "Provides a workaround for https://github.com/docker/for-linux/issues/1179 ... Run `docker ps --format={{json .}} --size=false` and check that size isn't calculated".

Complaint issue: docker/for-linux#1179 (OPEN, 2021-01-05) "docker ps --format='{{json .}}' is extremely slow due to Size field (Fedora 33)": "The command runs extremely slowly (30+ seconds) if there are multiple large containers ... The cause appears to be the field "Size"."
thaJeztah: "ISTR, it looks at the template to automatically decide wether or not it should fetch the size; in case of `{{ json . }}` it therefore determines that the Size field is needed, so it requests that data".
laurazard: "it's now possible to run `docker ps --format='{{json .}}' --size=false` which should not incur the performance penalty". thaJeztah on old CLIs: "older versions of the CLI would ignore that case, and continue using the "automatic detection" (in case of `{{ json .}}` that would mean; still go the "slow path" and request the `Size`)".

## 2. Daemon side (containerd image store)

MOBY/daemon/list.go#L163-L170 (per-container worker in errgroup, L143 `g, ctx := errgroup.WithContext(ctx)`, L186-188 `if err := g.Wait(); err != nil { return nil, err }`):

```go
			// get the image size (calculation is slow)
			if filter.Size {
				var err error
				newC.SizeRw, newC.SizeRootFs, err = daemon.imageService.GetContainerLayerSize(ctx, newC.ID)
				if err != nil {
					return err
				}
			}
```

=> one container's size error fails the WHOLE `GET /containers/json?size=1` (same code in docker-v29.0.0 L166-171 and docker-v29.9.0 L164-169). Parallelism added by moby/moby#49365 (fixes #47581 "docker ps very slow with containerd image store").

MOBY/daemon/containerd/service.go#L336-L367:

```go
func (i *ImageService) GetContainerLayerSize(ctx context.Context, containerID string) (int64, int64, error) {
	ctr := i.containers.Get(containerID)
	...
	snapshotter := i.client.SnapshotService(ctr.Driver)
	rwLayerUsage, err := snapshotter.Usage(ctx, containerID)
	if err != nil {
		if cerrdefs.IsNotFound(err) {
			return 0, 0, errdefs.NotFound(fmt.Errorf("rw layer snapshot not found for container %s", containerID))
		}
		return 0, 0, errdefs.System(errors.Wrapf(err, "snapshotter.Usage failed for %s", containerID))
	}

	unpackedUsage, err := calculateSnapshotParentUsage(ctx, snapshotter, containerID)
	if err != nil { ... log Warn only ... }
	...
	return rwLayerUsage.Size, rwLayerUsage.Size + unpackedUsage.Size, nil
```

MOBY/daemon/containerd/image_snapshot.go#L284-L320 calculateSnapshotParentUsage / calculateSnapshotTotalUsage (walks parent chain calling snapshotter.Usage; L313 `errors.Wrapf(err, "snapshotter.Usage failed for %s", next)`).
Introduced by moby/moby#44934 (2023-03) and #46079 "c8d/container: Follow snapshot parents for size calculation".

Why it's expensive / racy: containerd overlay snapshotter (vendored containerd v2.4.1) plugins/snapshots/overlay/overlay.go#L243-266: for `snapshots.KindActive` (container rw layer) it does `fs.DiskUsage(ctx, upperPath)`; continuity v0.5.0 fs/du_unix.go#L50-85 does `filepath.Walk(root, func(path, fi, err) error { if err != nil { return err } ...` -> any file deleted between readdir and lstat aborts with `lstat .../snapshots/<n>/fs/...: no such file or directory`. Committed (image) snapshots return stored metadata (cheap).

Contrast graphdriver store MOBY/daemon/images/image_unix.go#L19-L50: errors are only logged (`Driver %s couldn't return diff size ...`, sizeRw = -1) and nil error returned -> list never fails.

Issues with this error text (none filed in moby/moby itself found via `gh search`):

- openzim/zimfarm#1591: `500 Server Error for .../v1.52/containers/.../json?size=True: Internal Server Error ("snapshotter.Usage failed for 296cb2...: lstat /var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/174/fs/tmp/c0f28ef1-...: no such file or directory")`
- ptone/scion#1867: "`{{json .}}` ... causes Docker CLI to send `size=1` ... If any file in a container's overlay diff is deleted between the `readdir()` and `lstat()` calls ... the entire `docker ps` call fails with: snapshotter.Usage failed for <sha>: lstat /var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/<id>/fs/tmp/tmp.XYZ: no such file or directory" ; "`docker ps` fails 10/10 times with `{{json .}}`, and succeeds 10/10 times with explicit fields that exclude `Size`."
- ptone/scion#1864: "The `docker system df` call also failed: snapshotter.Usage failed for 8bcc36d5...: lstat .../overlayfs/snapshots/16486/fs/tmp/tmp.4CYSHPtOYt: no such file or directory"
- link-assistant/hive-mind#3000 (this repo's issue).
- Related moby: #52012 "rw layer snapshot not found" on system prune -> fixed by moby/moby#52090 "container/prune: Don't fail early on layer size errors" (merged 2026-02-25, in 29.3.0) — only prune path; list.go still fails hard.

## 3. docker system df

CLI/cli/command/system/df.go#L43-L47:

```go
	// TODO expose types.DiskUsageOptions.Types as flag on the command-line and/or as separate commands (docker container df / docker container usage)
	du, err := dockerCli.Client().DiskUsage(ctx, client.DiskUsageOptions{
		Verbose: opts.verbose,
	})
```

Only flags: `--verbose`, `--format` (L37-38). No type flag -> client sends no `type` (moby client/system_disk_usage.go#L124-L145 adds `type=` only for set booleans Containers/Images/Volumes/BuildCache) -> daemon computes everything.
Daemon MOBY/daemon/server/router/system/system_routes.go#L147-L166:

```go
	typeStrs, ok := r.Form["type"]
	if versions.LessThan(version, "1.42") || !ok {
		getContainers, getImages, getVolumes, getBuildCache = true, true, true, s.builder != nil
	} else {
		for _, typ := range typeStrs { switch system.DiskUsageObject(typ) { case system.ContainerObject: ... case system.ImageObject: ...
```

api/docs/CHANGELOG.md v1.42: "`GET /system/df` now accepts query parameter `type`. When set, computes and returns data only for the specified object type. The parameter can be specified multiple times ... Supported values are: `container`, `image`, `volume`, `build-cache`." swagger.yaml ~L11022.
Containers part: MOBY/daemon/disk_usage.go#L17-L23 calls `daemon.Containers(ctx, &backend.ContainerListOptions{Size: true, All: true})` -> same list.go path -> same hard failure (wrapped "failed to retrieve container list: ...").
So `docker system df --format ...` cannot restrict; to get images-only call API directly: `curl --unix-socket /var/run/docker.sock 'http://localhost/v1.47/system/df?type=image'` (any API >=1.42).

## 4. docker image ls --format '{{json .}}'

CLI/cli/command/image/list.go#L99-L105: `client.ImageListOptions{All, Filters, Manifests: useTree}` — no SharedSize/ContainerCount request; no template pre-processing. formatter/image.go#L248-271 accessors (Size/Containers/SharedSize/UniqueSize) are pure formatting; Containers/SharedSize print "N/A" when -1. `--format` disables tree (`shouldUseTree` L168-173), so Manifests=false.
Daemon containerd store MOBY/daemon/containerd/image_list.go: always computes unpacked size per image via `img.SnapshotUsage(...)` (L359, L534) -> image_manifest.go#L256-277 -> calculateSnapshotTotalUsage over committed image snapshots (metadata lookups, no fs walk); errors only logged ("failed to calculate unpacked size of image"). Container count L372-376 is an in-memory loop over `i.containers.List()` — no snapshot walk. SharedSize (L201-224, snapshotter.Usage per layer, returns error) only when `shared-size=1`, which the CLI never sends for `image ls` (used by system df: disk_usage.go#L61-64 `SharedSize: true`).
=> `docker image ls --format '{{json .}}'` does NOT trigger container rw-layer walks.

## 5. Docker 29 release notes (docker/docs content/manuals/engine/release-notes/29.md; https://docs.docker.com/engine/release-notes/29/)

- 29.0.0: "containerd image store is now the default for **fresh installs**. This doesn't apply to daemons configured with `userns-remap` (see moby#47377)."
- 29.0.0: "`docker image ls` now uses the new view (like `--tree` but collapsed) by default. docker/cli#6566"
- 29.2.1: "Fix `docker system df` failing when run concurrently with `docker system prune`. moby/moby#51979"
- 29.3.0: "Fix `docker system prune` failing with "rw layer snapshot not found" when a container is concurrently removed. moby/moby#52090"
- 29.5.3: "Reduce `docker system df` errors when images are pruned at the same time with the containerd image store. moby/moby#52672"
- 29.6.0: "Fix `docker system df` image size reporting to count only snapshots directly used by images. moby/moby#52901"
- No release note (up to 29.9.0) changes `docker ps --size`/`size=1` failure semantics or the {{json .}} auto-detection.
