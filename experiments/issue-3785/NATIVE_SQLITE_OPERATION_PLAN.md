# Canonical SQLite operation lifetime

This is a remaining acceptance boundary, separate from successful startup
configuration and file-type admission. No implementation is claimed here.

- [x] Trace the prepared pinned native configuration admission and the actual
      codex-state SQLite connection shim. Startup validates the root and existing
      database/journal files but retains no operation lease.
- [x] Identify writable pools, read-only pools, old-log cleanup pools, lazy
      replacement connections and direct reclamation connections. A repair
      must cover all of them, including retained transactions and recovery.
- [x] Finish the current combined default suite without changing its sources
      or imported probe dependencies.
- [x] Add a separate actual-native lifetime probe using the existing bounded
      compression app-server/process fixture without modifying its imported
      dependencies during the combined default run. Native section create/list
      operations exercise SQLite reads and writes without a model request.
- [x] Reproduce selected-root rename/recreation and database replacement after
      initialization, then verify subsequent thread-list/read/write behavior.
      Preserve both retired and replacement evidence, exact binary digest,
      actual response/error and finite process/output/resource limits.
- [ ] Design native operation admission around held directory/database identity.
      A pool-acquisition hook alone does not cover a retained transaction or
      SQLite background writer. Do not present it as a complete lease.
- [x] Write a minimum failing automated native control before the repair.
      Preserve ordinary unselected behavior and healthy concurrent peers.
- [ ] Require actual development, optimized x64/ARM64, installed package and
      final image controls before production default activation.

The prepared upstream connection shim is codex-rs/state/src/sqlite.rs:
open_read_write_pool_with_spec, open_read_only_pool,
open_legacy_logs_for_cleanup and connect_once. Reclamation also opens a direct
SqliteConnection in state/src/runtime/reclamation.rs. Existing startup admission
is applied by native-codex/apply_sqlite_authority.py and
canonical_sqlite_authority.rs. Keep probe-codex-native-sqlite-authority.py and
probe-codex-native-sqlite-binding.py controls. The additional
probe-codex-native-sqlite-lifetime.py reuses the native compression fixture and
requires post-replacement refusal by default; --expect-retired is only its
explicit negative control, never a successful admission gate.

Both optimized-native directory and database replacement controls now reproduce
actual retired SQLite reads and writes. Both strict controls fail as required
before repair. See evidence/native-sqlite-operation-before.txt in the case study;
these negative controls do not complete the operation-lifetime criterion.

## Operation-hook design control

`probe-sqlite-progress-close.py` tests a progress-hook-only design against the
host SQLite 3.45.1 library with finite synthetic WAL databases. Healthy reads
work; every unsafe query refuses after one callback. Directory and database
replacement do not change the retired main file at close. However, adding a
hardlink or loosening directory/database permissions still lets close change
the unsafe main file, with zero progress callbacks during close. This is a
separate system-SQLite design control, not compiled Codex acceptance.

Inference: statement or pool admission plus a progress callback cannot alone
cover SQLite cleanup writes. Any repair also needs the I/O boundary, including
journal/SHM operations and close, plus checks covering cached query results.
Keep healthy multi-process WAL behavior; silently forcing a different journal
mode would introduce another migration/concurrency requirement. Existing
canonical auth and session-index modules demonstrate held-directory identity
and descriptor-relative paths, but do not wrap SQLite's retained connections.

Primary API references: [progress callbacks](https://www.sqlite.org/c3ref/progress_handler.html),
[I/O methods](https://www.sqlite.org/c3ref/io_methods.html) and
[VFS callbacks](https://www.sqlite.org/c3ref/vfs.html). The documented progress
callback runs during query preparation/execution; the OS interface has separate
read, write, sync, truncate, locking, shared-memory, close and deletion hooks.

## Combined statement and I/O design control

`probe-sqlite-vfs-close.py` builds the separate C fixture against system SQLite.
It combines progress admission with guarded VFS read/write/truncate/sync/locking,
file-control, SHM and deletion callbacks. It keeps lock release and resource
disposal available after sticky refusal, suppresses unsafe SHM deletion, and
disables database mmap fetches so reads retain an I/O boundary.

All twelve controls pass: the six mutations above, each followed either by a
query/write attempt or directly by close. Every unsafe case preserves the exact
database, WAL and SHM file bytes through close. Healthy queries, writes and WAL
checkpoint/close still succeed. Data and compiler allocations are limited to
128 MiB, stack to 8 MiB, core to zero, each inspected file to 1 MiB, setup and
execution to five seconds each, compiler execution to thirty seconds, and
progress callbacks to fewer than 10000 per process. All children are reaped.

This fixture tracks one database and only the selected directory's final named
component. It does not admit all canonical filenames, validate ancestor aliases,
pin every journal identity, exercise multiple peers or attach SQLx hooks. Its
extra database descriptor remains open until after SQLite closes; a production
implementation must respect SQLite's POSIX lock lifetime and must not close an
independent descriptor while another connection holds locks on that inode.

- [x] Falsify progress-only cleanup admission with a bounded executable control.
- [x] Verify the combined VFS/progress design with queries and close-only cases.
- [x] Verify the same control against the checked, pinned SQLite source component.
- [ ] Implement full native authority and callback ownership, covering every
      canonical database and journal, aliases and healthy concurrent WAL peers.
- [ ] Attach before startup PRAGMAs, to replacement connections, read-only and
      legacy cleanup pools and direct reclamation connections. Preserve explicit
      refusal through native app-server and CLI fallbacks.
- [ ] Measure healthy query overhead and run the actual native lifetime controls
      before updating release recipe/source inventories and requesting CI builds.

The source API inspection uses official crates.io archives for sqlx-sqlite 0.9.0
and libsqlite3-sys 0.37.0, each checked against the prepared Cargo.lock checksum
before extraction. SQLx exposes `lock_handle`, `set_progress_handler` and a
selected VFS option. Its connection-establishment PRAGMAs run before the pool's
`after_connect` hook, so that hook alone cannot admit initial SQLite I/O.

The exact checked sqlite3.c component from libsqlite3-sys 0.37.0 reports SQLite
3.51.3. All twelve combined controls pass against that source too. The separate
amalgamation compiler is limited to 384 MiB data, 8 MiB stack and thirty seconds;
fixture compilation and every test process remain limited to 128 MiB. This
checks the source component with its common bundled build definitions, not the
complete Codex dependency graph or its native executable.
