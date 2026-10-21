# Case study: issue #3583 — Formal AI sidecar wrote no logs or memory

## What happened

On a production bot (Hive Mind 2.39.2, Formal AI 0.354.1) the named volume
`hive-mind-formal-ai-memory` had been owned by `root:root` and empty since its
creation on 2026-08-12. `formal-ai serve` runs as `box` (1001:1001), so every
write to `/home/box/.formal-ai` failed with `Permission denied`. A single
sidecar life (763 stdout lines) contained 381 `logging_failure` records with
`reason file_write_failed` and about 124 `[dialog-log] failed to record
exchange: Permission denied (os error 13)` lines. Nothing in Hive Mind
reported it, and the stdout itself was deleted with the container by
`docker rm --force --volumes` on stop, replace and unload (#2305).

## Root cause

`ensureFormalAiMemoryVolume` returned early for a volume that already existed:

```js
const result = await ensureDockerVolume({ name: FORMAL_AI_MEMORY_VOLUME_NAME, ... });
if (!result.created) return result;
// chown -R box:box only for a fresh volume
```

A volume created by an older Hive Mind (before the chown existed), or one
whose chown had failed once, therefore stayed root-owned forever. Two further
gaps hid the failure: the sidecar's stdout was never read, and it was not kept
after the container was removed.

A fourth defect turned up while reproducing against real Docker: the chown
container ran as the image's default user. For an image whose `USER` is `box`
that is the user that cannot take the volume back, so the chown itself would
fail. It now runs with `--user 0:0`.

## Fix

| Requirement                      | Implementation                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership checked on every start | `probeFormalAiMemoryVolume` runs a one-off container as `box` (`test -w` plus the first entry not owned by `box`). Only a failing probe triggers `chown -R` as root, followed by a second probe; a repair logs `[formal-ai] memory volume was owned by <uid:gid>; fixed`. A healthy volume is never chowned.                              |
| Logging failures are not silent  | `checkFormalAiSidecarLogging` reads `docker logs --tail 200` after `/health`. A `logging_failure` record (or a dialog-log write error) becomes `Formal AI cannot write its logs or memory (…): dialogs of this session will not be kept` in the bot log, and reaches each task's solve log through `HIVE_MIND_FORMAL_AI_SIDECAR_WARNING`. |
| Stdout survives removal          | `archiveFormalAiSidecarLogs` streams `docker logs --timestamps` to `formal-ai-sidecar-<StartedAt>.log` in the bot log directory before every `docker rm` (release/stop, replacing a stopped container, `/unload`). The newest `HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP` (default 50) are kept; `0` turns it off.                             |
| Test                             | `tests/formal-ai-memory-ownership-3583.test.mjs` seeds a root-owned volume in the Docker simulator and checks that the next start fixes it and that `memory.lino` and `logs/` are then written. `experiments/issue-3583-real-docker-memory-ownership.mjs` repeats the scenario against a real Docker daemon.                              |

## Reproduce

```bash
# simulator (CI)
node tests/formal-ai-memory-ownership-3583.test.mjs
# real Docker: builds a throw-away image with a box user, creates a root-owned
# volume, runs ensureFormalAiMemoryVolume and the log archive, then cleans up
node experiments/issue-3583-real-docker-memory-ownership.mjs
```

The real-log fixture `tests/fixtures/formal-ai-sidecar-logging-failure-3583.log`
holds the first lines of the production sidecar's stdout from the issue's gist.
