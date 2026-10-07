# Automatic disk reclaim

Before `solve` or `hive` refuses work for insufficient disk space, Hive Mind
uses the pinned `disk-space-saviour` dependency to reclaim eligible npm, Bun,
pnpm, pip, uv and Cargo registry caches. The emergency pass is capped at the
**safe** tier and stops when the required free space is available. It only
cleans caches on the filesystem being checked. The disk gate measures free
space again afterward; an estimated cache size cannot admit a task.

During a working session, a maintenance pass runs every 30 minutes inside
the task workspace. Another pass runs after the AI tool finishes. These passes
only select superseded Rust artifacts, preserving the newest build generation.
Library artifacts remain protected while Cargo or rustc runs. Idle incremental
sessions and superseded test/example binaries may be pruned during a build,
with a minimum three-hour age and open-file checks. DSS checks liveness and Git
tracking again before deleting paths. Unreadable process information blocks
reclamation. Whole `target/`, installed dependencies and source files are
outside this integration's cleanup scope.

| Environment variable          | Default | Purpose                                                                 |
| ----------------------------- | ------- | ----------------------------------------------------------------------- |
| `HIVE_MIND_AUTO_RECLAIM`      | `safe`  | Use scoped safe reclaim; `off` disables DSS scans and cleanup.          |
| `HIVE_MIND_RECLAIM_STALE_AGE` | `1h`    | Rust activity window, such as `2h`; DSS retains its longer leaf window. |

Unsupported reclaim modes disable DSS cleanup. `moderate` and `aggressive`
are not enabled. Dry runs and command-preparation sessions do not run DSS.
The existing workspace, agent snapshot and explicitly configured image
cleanup policies continue independently of these settings.

Task logs contain `[DSS_SCAN]` JSON summaries with sizes, blockers and scanner
errors, and `[DSS_RECLAIM]` JSON records with every action's paths, status and
bytes. The final line gives the persistent DSS audit file location. Failed
scans or cleanup attempts leave the existing disk gate in charge.
Set `DSS_DEBUG=1` to trace the underlying DSS commands and timings.

Dockerfiles clear npm and Bun download caches in the same `RUN` instructions
that install packages. This prevents those installation layers from retaining
download archives. Browser installations and global agent CLIs are preserved.
Caches inherited from the Box base image still occupy its lower layers;
deleting them in a derived image or running container does not free those
bytes. The base image must clean its own installation layers to reclaim them.

## Container maintenance boundary

This integration passes `docker: false` on every DSS scan and grants no
container, image or volume removal consent. It never invokes Docker to stop,
restart, inspect or remove task containers. A solver running inside a task
container can attempt local workspace maintenance; if DSS cannot verify its
processes, it skips the affected artifacts and reports the blocker.

Recursive DinD maintenance and finished-container pruning/removal depend on
[disk-space-saviour#14](https://github.com/link-foundation/disk-space-saviour/issues/14).
The reported v0.13.1 DinD probes cannot verify open files, and Docker writable
layer size failures can discard an entire scan. These operations remain
disabled. `HIVE_MIND_REMOVE_FINISHED_CONTAINERS` is not implemented by DSS
integration. Enabling removal later requires clean/pushed verification
regardless of task exit code, uploaded task logs, saved `docker logs`, and a
check that the session is not pending resume.

## Validation

Run `node tests/disk-reclaim-2294.test.mjs`. The tests simulate a disk gate with
10 MB free and a 100 MB requirement: cache reclaim restores 120 MB and work
is admitted. An optimistic reclaimed-byte report without increased free space
still refuses work. Real DSS tests use temporary Rust build files, verify
active-build protection, and remove only the superseded hash after Cargo exits.
Timer tests verify that passes do not overlap and shutdown drains all work.
Dockerfile checks pin cache cleanup to each installation layer.

The reproducing disk-gate test failed before the reclaim hook was added
(`attempts: 0`, expected `1`). See
[issue #2294](https://github.com/link-assistant/hive-mind/issues/2294) and its
[production status update](https://github.com/link-assistant/hive-mind/issues/2294#issuecomment-6043144775)
for the original incident and remaining upstream limits.
