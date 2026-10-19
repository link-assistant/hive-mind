## Summary

`$ --isolated docker` passes the hard memory limit through (`--memory`, `--memory-swap`, also as `N%` of host RAM), but not Docker's soft limit, `--memory-reservation`. A supervisor that runs several tasks on one host wants both: a hard cap per container (so one task cannot OOM the host) and a lower reservation (so under memory pressure the kernel reclaims from the containers that exceed their share first, instead of OOM-killing the busiest one).

Found in [link-assistant/hive-mind#3530](https://github.com/link-assistant/hive-mind/issues/3530) / [#3125](https://github.com/link-assistant/hive-mind/issues/3125) (start-command 0.38.0, Linux 6.8).

## Reproduction

```bash
$ --version                     # start-command version: 0.38.0
$ --isolated docker --image alpine:3.20 --memory 256m --memory-reservation 64m -- echo hi
# Error: Unknown wrapper option: --memory-reservation
```

`docker run --memory 256m --memory-reservation 64m alpine:3.20 echo hi` accepts the same pair.

## Expected

`--memory-reservation <size|N%>` is accepted like `--memory`, forwarded to `docker run --memory-reservation`, recorded in the execution (so `$ --resume` relaunches with it), and shown in `$ --status`. Like Docker, it should be refused when it is not below `--memory`.

## Workaround used in hive-mind

After the launch, hive-mind sets the reservation on the running container: `docker update --memory-reservation <size> <container>`. This adds a second command after every launch, and the value is lost when `$ --resume` recreates the container.

## Suggested fix

Handle `--memory-reservation` in the wrapper option parser where `--memory` and `--memory-swap` are handled: reuse the size / `N%` parsing, store it next to `memory` in the execution options, and add `--memory-reservation <value>` to the docker run arguments when set. A regression test: parse `--memory 256m --memory-reservation 64m` and assert that both reach the docker arguments, and that `--memory-reservation 512m --memory 256m` is refused.
