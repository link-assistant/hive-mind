# Native migration handoff across task configuration disposal

The actual native CLI built by [run 41070646110](https://github.com/link-assistant/hive-mind/actions/runs/41070646110)
at `1c183b3475cf94dc99073820d46a1747cbf68947` reproduces a second
configuration-disposal boundary, separately from compressed-history SQLite paths.

The pinned source's `thread-store/src/local/rollout_migration/publish.rs` writes
`CODEX_HOME/rollout-migrations/<thread-id>.pending` before converting a legacy
rollout. This durable journal hands incomplete publication to a later owner.
Sharing only sessions, archives and writer locks leaves that handoff private.

`experiments/issue-3785/probe-codex-native-migration.py` exercises the real
`migrate-rollouts --apply` command with one finite synthetic transcript below
5 MiB. Its native throughput limiter makes the pending-journal stage observable.
The probe kills and reaps the complete owner process group before deleting the
private configuration; the unchanged canonical transcript remains. Before the
repair, the native journal disappears with the configuration.

The repair projects a fourth directory, `rollout-migrations`, into fresh task
homes and Docker tasks. A nonempty private journal directory refuses online
migration: copying or renaming a recovery handoff while its native owner may run
would make two independent namespaces. Empty private directories can join the
canonical namespace. Router suppression still withholds vendor state.

Five directory/mount regressions fail before the repair. Three additional
controls reproduce linked canonical/private parents and canonical parent
replacement during mkdir. Scoped setup now uses the existing descriptor-based
preparation helper for private parents and canonical directories. On Linux,
creation stays relative to held directory descriptors and changed public paths
refuse admission. Foreign sentinels remain unchanged. This does not establish
continuous native mutation or later daemon path attestation.

After journal projection, the actual interrupted migration retains its journal
inode after owner disposal. A fresh native process completes migration, publishes
paginated history and clears the journal. Fresh resume then reproduces the
separate pre-repair SQLite alias defect. `--expect-private-metadata` checks that
exact failure; it is not a positive resume result. The strict positive requires
canonical persisted paths and the prior conversation on fresh native resume.
The rebuilt CLI from [run 41076013002](https://github.com/link-assistant/hive-mind/actions/runs/41076013002)
at `67da7a5927f4ac2272a85557d845860a445be5d9` passes that strict combined
control locally: the real peer finishes migration and the fresh process resumes
the prior conversation after owner configuration disposal.

The native workflow includes the omitted-journal negative control, the
intermediate private-metadata negative control and the strict rebuilt positive.
Each native process has a 512 MiB data limit and 16 MiB stack limit; IPC, stage
waits, input size and diagnostics are bounded. No provider traffic is forwarded
and no real credentials are used. Cleanup failure retains the fixture.

## Unsafe native journal targets

The actual native writer also opens a pending journal with create/truncate,
following symlinks and accepting hard links. Two additional controls place a
linked synthetic sentinel at the native journal pathname. Both reproduce the
CLI truncating unrelated evidence. The strict refusal assertion fails before
repair; no real credentials or conversations are involved.

`apply_migration_journals.py` pins both native source files. With the canonical
rollout selector present, it validates the journal before migration changes
SQLite/history and creates empty receipts through held canonical directories.
It refuses linked, nonregular, nonempty, public or multiply linked receipts;
valid existing receipts retain their inode without truncation. Ten standalone
Rust controls cover safe creation/retry/disposal, unsafe targets and changed
parents/projections. The selector-absent native behavior is preserved.

Actual compiled symlink/hard-link refusal and another interrupted-migration
positive are required by the next CI run. Standalone safety checks do not
establish those results. Other migration staging/cleanup writers, post-publish
crashes and complete power-loss durability remain unverified.

Complete canonical history, safe legacy-state migration and production native
adapter installation remain unfinished. Successful execution homes are retained.
