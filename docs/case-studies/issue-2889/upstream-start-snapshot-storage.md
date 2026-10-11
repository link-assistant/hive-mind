## Summary

`$ --resume <id> -- <command>` on a stopped Docker container (`docker-snapshot` mode) `docker commit`s the container's **whole writable layer** to `start-command-resume/<name>:<attempt>` and runs the command in a new `<name>-resume-<attempt>` container. Nothing bounds that copy:

1. **No free-disk preflight.** The commit starts even when the data root cannot hold it. On the containerd image store (the default for fresh Docker Engine 29 installs) a commit writes a compressed blob **and** an unpacked snapshot, while the original container stays on disk. Peak usage is about 3× the writable layer.
2. **No serialization.** `$ --resume` processes for different executions commit at the same time.
3. **No cleanup.** After the new container starts, the stopped original (all of its data is now in the image) is kept, and the `start-command-resume/*` image is never removed, even after the resumed container finishes and is removed.
4. **No copy-free way to run a different command in the same container.** `docker-start` mode (no command) re-runs the original `Config.Cmd`; anything else is a full commit. The `docker-cleanup.js` hint "Run another command in the same container: `$ --resume <id> -- <command>`" is misleading: it is a copy in a new container.

On containerd the commit is also slow regardless of the change size: the default differ (`doubleWalkDiff`) walks both full trees ([Sealos measured a 1 KB commit at 39 s and 10 GB at 847 s](https://sealos.io/blog/sealos-devbox-commit-performance-optimization/)).

## Incident

link-assistant/hive-mind#2889 (2026-10-09, start-command 0.35.4; the behaviour is unchanged in 0.36.0, Docker 29.6.1 with the containerd image store). A dockerd restart killed four Rust build containers (writable layers 11, 21.2, 23.5 and 36.8 GiB, mostly Cargo `target/`). Their supervisor resumed all four with `$ --resume <uuid> -- <command>` within a minute. Four concurrent commits used about 280 % CPU for 30+ minutes and took free disk from 52 GB to 2 GB. Two commits failed with `failed to apply diff: … no space left on device`, and the two that succeeded left 11 + 23.5 GiB originals next to their images. (The record loss seen in the same incident was #193, fixed in #196.)

## Reproduction (bounded: 2 × 256 MiB, start-command 0.36.0)

```sh
for n in snap-a snap-b; do
  $ --isolated docker --detached --session $n --image alpine:3.20 -- sh -c 'dd if=/dev/zero of=/root/big bs=1M count=256; sleep 600'
done
sleep 6; docker kill snap-a snap-b

# The supervisor resumes both killed sessions with a command at the same time
$ --resume snap-a -- sh -c 'sleep 600' &
$ --resume snap-b -- sh -c 'sleep 600' &
wait

docker images 'start-command-resume/snap-*'     # a full copy of each layer
docker ps -a --filter name=snap-                # the stopped originals are still there
docker rm -f snap-a-resume-1 snap-b-resume-1    # the resumed containers are gone, the images stay:
docker images 'start-command-resume/snap-*'
```

Actual output (Docker 29.8.0, start-command 0.36.0; [script](https://github.com/link-assistant/hive-mind/blob/issue-2889-b3cf2ad55a40/experiments/issue-2889-concurrent-snapshot-resume.sh), [log](https://github.com/link-assistant/hive-mind/blob/issue-2889-b3cf2ad55a40/docs/case-studies/issue-2889/data/concurrent-snapshot-resume-start-0.36.0.log)):

```
writable layers: /snap-a=268435456 /snap-b=268435456
snap-b: $ --resume ran from +0.95s to +6.55s
snap-a: $ --resume ran from +0.95s to +6.75s
docker events (seconds after both resumes started):
  +5.72s commit snap-b
  +6.16s commit snap-a
  +6.41s start snap-b-resume-1
  +6.62s start snap-a-resume-1
start-command-resume/snap-a:1 276MB
start-command-resume/snap-b:1 276MB
snap-a-resume-1 Up 2 seconds
snap-b-resume-1 Up 2 seconds
snap-b Exited (137) 13 seconds ago
snap-a Exited (137) 13 seconds ago
after the resumed containers are removed:
start-command-resume/snap-a:1 276MB
start-command-resume/snap-b:1 276MB
snap-b Exited (137) 15 seconds ago
snap-a Exited (137) 15 seconds ago
```

The two commits overlap completely. Nothing checked the free space first. Both originals and both images outlive the resumed containers. With the incident's layer sizes, the same sequence needs about 3 × 92.5 GiB at its peak.

(On 0.35.4 two concurrent resumes of the **same** execution both committed and the second failed only at `docker run` with a container-name conflict. The #196 launch reservation in 0.36.0 now rejects the second one: `Launch reservation failed: A different resume already reserved this execution`.)

A single resume behaves the same way (Docker 29.8.0, start-command 0.35.4, 64 MiB layer): `mode=docker-snapshot in 2511 ms; images: start-command-resume/<name>:2 74.9MB`, with the original container still present ([log](https://github.com/link-assistant/hive-mind/blob/issue-2889-b3cf2ad55a40/docs/case-studies/issue-2889/data/docker-start-handoff-experiment.log)).

## Workaround (used in hive-mind#2894)

Make the container itself accept a new command, so `docker start` (no copy) is enough. The container is created with a prefix:

```sh
h='/tmp/hive-mind-resume-command-<token>'; if [ -f "$h" ]; then exec sh "$h"; fi; <original command>
```

To run a new command in the stopped container, write it with `docker cp` (works on stopped containers), then `$ --resume <id>` **without** a command:

```sh
printf 'exec sh -c %s\n' "'echo recovered; ls /root'" > /tmp/cmd && docker cp /tmp/cmd snap-demo:/tmp/hive-mind-resume-command-<token>
$ --resume snap-demo        # mode docker-start: same container ID, same writable layer, nothing committed
```

Verified on Docker 29.8.0 with start-command 0.35.4 and 0.36.0: docker-start (643 ms on 0.35.4), the same container ID, the task's files present, and no image or `-resume-` container created. For containers that still need a snapshot, hive-mind now runs them one at a time and only with free space ≥ 2 × the writable layer + 10 GiB, and it removes the original with `docker rm` (not `-f`) after the new container starts. Images are removed with `docker rmi` when the task finishes.

## Suggested fix

1. **Copy-free command resume.** Offer a mode that runs a new command in the **same** container, e.g. `$ --resume <id> --in-place -- <command>`, or make it the default when the container was launched by start-command. Launch every detached docker container with a handoff prefix like the one above (start already uses the same `docker cp` marker technique for `--on-kill-resume` in `execution-recovery.js`). On resume, `docker cp` the command into the stopped container and `docker start` it. Fall back to `docker-snapshot` only for containers without the prefix.
2. **Preflight in `docker-snapshot`.** Before `docker commit`, read `docker inspect --size -f '{{.SizeRw}}'` and the free space of the data root (`docker info -f '{{.DockerRootDir}}'`, plus containerd's root when the containerd store is used). Refuse, or wait with a clear status, when free < 2 × SizeRw + a reserve. Report `snapshotting N GiB` in the status/log.
3. **Serialize snapshots** across `$` processes, for example with a host-wide lock file next to the execution store. Do not hold the store lock itself; see #193.
4. **Clean up.** Add an opt-in `--remove-original` (or a cleanup policy) to `docker rm` the stopped original once the snapshot container is running, and `docker rmi` the `start-command-resume/*` images when the resumed container is removed by the existing cleanup policy (`docker-cleanup.js`).
5. **Fix the hint** in `docker-cleanup.js`: "Run another command in the same container" should say that it snapshots the filesystem into a new container.
