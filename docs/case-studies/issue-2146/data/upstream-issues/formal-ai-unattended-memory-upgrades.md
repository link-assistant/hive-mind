# Support unattended, non-destructive persisted-memory upgrades for server containers

## Downstream use case

[`link-assistant/hive-mind#2146`](https://github.com/link-assistant/hive-mind/issues/2146) now requires its Formal AI sidecar to:

1. exist only while one or more Formal AI tasks are running;
2. keep memory across tasks and container restarts;
3. pull and start the latest Formal AI image only while no Formal AI task is active; and
4. replace the previous image without risking destructive memory migration.

Hive Mind can own task counting, image pulls, an internal task-only Docker network, and the sidecar lifecycle. It cannot infer whether a future Formal AI binary can safely open or migrate memory written by an older version.

## Reproduction of the missing contract

```bash
docker volume create formal-ai-memory-repro

docker run -d --name formal-ai-old --privileged \
  -e FORMAL_AI_MEMORY_PATH=/root/.formal-ai/memory.lino \
  -v formal-ai-memory-repro:/root/.formal-ai \
  ghcr.io/link-assistant/formal-ai:v0.333.2 \
  formal-ai serve --agent-mode --host 0.0.0.0 --port 8080

# Create real memory through the server, then prepare an unattended replacement.
docker stop formal-ai-old
docker pull ghcr.io/link-assistant/formal-ai:latest
```

At this point an orchestrator has no machine-readable way to answer all of these before reusing the volume:

- Which persisted-memory schema did the old image write?
- Does the candidate image support that schema?
- Will startup or the first request migrate the file?
- Is the migration non-destructive, atomic, and idempotent?
- Which backup is sufficient for rollback?
- Can the old image reopen data after a failed candidate start?

Current `GET /health` returns `status`, `model`, and the binary `version`, but no persisted-memory schema or compatibility range. `formal-ai memory export` / `bundle export` provide an excellent manual backup path. `suggest_migrations` only returns human-readable seed-version advice after parsing an imported bundle; it is not a preflight or transactional on-disk migration API.

## Current workaround

Keep the Formal AI image pinned. For a manual upgrade while all writers are stopped:

1. archive the raw persistent volume and export a full bundle with the old image;
2. start the candidate against a copy of that volume;
3. run a complete memory/bundle export and a representative read-only query;
4. compare event counts and stable identifiers; and
5. restore the raw archive and old image digest if any validation fails.

Hive Mind can automate this conservative process, but without an upstream compatibility contract it cannot know that a successful health check or export exercised every migration path.

## Suggested implementation

Expose a machine-readable, side-effect-free preflight, for example:

```bash
formal-ai memory upgrade-status --path /root/.formal-ai/memory.lino --format json
```

Suggested result fields:

```json
{
  "binary_version": "0.334.0",
  "detected_schema_version": 1,
  "minimum_readable_schema_version": 1,
  "maximum_readable_schema_version": 1,
  "target_schema_version": 1,
  "compatible": true,
  "migration_required": false,
  "migration_id": null,
  "rollback_supported": true
}
```

If a migration is required, provide a separate explicit command that:

- refuses to run while the memory file is locked by another writer;
- creates a full verified backup before changing data;
- writes to a new file and commits with an atomic rename;
- preserves unknown/optional fields, event IDs, ordering, and append-only history;
- is idempotent after interruption or retry;
- emits a machine-readable migration receipt; and
- documents whether the previous binary can reopen the migrated file or requires restoring the backup.

The server health response could additionally expose the memory schema and migration state after startup, but `/health` should not itself perform a migration.

## Acceptance tests

- Build fixtures with every released persisted-memory schema still supported, including missing optional fields and unknown future fields.
- For each supported old-version fixture, run preflight, migrate a copy, load/export/query it with the new binary, and assert no event, ID, ordering, evidence, or metadata loss.
- Interrupt migration before commit and prove the original file remains byte-identical and usable.
- Run the migration twice and prove the second run is a no-op.
- Exercise concurrent-writer locking and fail rather than migrating live data.
- Exercise a deliberately incompatible fixture and return a non-zero, machine-readable refusal without modifying it.
- Exercise documented rollback: either reopen with the old image or restore the verified backup.
- Add an old-container → candidate-container integration test using the same named Docker volume.

This upstream contract would let Hive Mind safely implement idle-only `latest` image replacement while keeping Formal AI memory durable between stopped containers.
