# Canonical SQLite operation lifetime

This is a remaining acceptance boundary, separate from successful startup
configuration and file-type admission. The component adapter below is a draft;
the production recipe does not consume it.

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

## Native connection callbacks and descriptor ownership

- [x] Verify automatic connection hooks run before the initial PRAGMA and leave
      ordinary connections alone, using the exact checked SQLite component.
- [x] Inspect actual SQLite-owned main/SHM descriptors through the pinned Unix
      FILESTAT control with its opt-in build flag. Keep SQLite responsible for
      closing its own handles and preserve unrelated native progress handlers.
- [x] Find every native progress-handler replacement: quick-check, integrity
      checks and reclamation install their own deadline callbacks. A guard
      installed only in that slot would be removed during healthy operation.
- [x] Verify a separate statement/row/profile callback plus selected VFS checks
      against every managed database, aliases, journals and concurrent peers.
- [ ] Integrate the admitted adapter and exact compiler inputs into the checked
      prepared source, source inventory, release recipe and all native gates.

The eight `probe-sqlite-native-handles.py` controls pass against SQLite 3.51.3.
The descriptor control deliberately does not claim cleanup-write refusal;
`probe-sqlite-selected-vfs.py` is the separate draft statement/I/O integration.
Its final 715 component controls pass: 57 healthy and 658 explicit refusals with
exact preservation of the database, WAL and SHM bytes. These include every one of
the seven databases, cached queries, retained transactions, initial PRAGMAs,
read-only and replacement connections, native deadline-handler replacement,
three threads, two concurrent WAL processes, and a verified file-backed scratch
table. Production does not consume the draft yet.

Official API references: [connection hooks](https://www.sqlite.org/c3ref/auto_extension.html),
[FILESTAT and VFS controls](https://www.sqlite.org/c3ref/c_fcntl_begin_atomic_write.html)
and [statement/row/profile events](https://www.sqlite.org/c3ref/c_trace.html).
The trace callback return is ignored by SQLite, so an unsafe authority must
produce an explicit process refusal rather than return a nonzero trace result.

## Actual SQLx and configuration-lock controls

`build_sqlite_vfs_control.py` builds only the adapter and real SQLx 0.9.0 with
bundled libsqlite3-sys 0.37.0, not the Codex workspace. Each compiler has a
512 MiB data limit and 16 MiB stack; jobs and incremental compilation are
disabled or limited. The first build found a diagnostic-variable shadowing
compile error, fixed before any runtime assertion was counted. No compiler was
killed. `probe-sqlx-selected-vfs.py` passes all 20 query/close controls, preserving
unsafe file bytes while healthy selected and ordinary in-memory connections
work. The isolated crate's lock resolution is not the complete Codex graph.

`probe-sqlite-config-lock.py` reproduces a second real defect: opening and
closing an independent descriptor during native configuration admission
releases a pre-existing POSIX database lock owned by this process. The original
core module fails the strict control; the draft prepared core module passes.
The latter checks path metadata without closing extra database descriptors;
the selected adapter holds bounded main descriptors until process disposal.
This lock control links host SQLite only for registration and uses no SQLite
data I/O; its result is distinct from the pinned component and real SQLx tests.

The checked source applier attaches the draft before startup connection PRAGMAs
and covers writable, read-only, legacy cleanup, direct reclamation and lazy
replacement connections. Its applicability and prepared output have been
checked, but that output has not been compiled as the full native CLI.

- [x] Verify the real SQLx adapter in a bounded isolated crate.
- [x] Reproduce and repair configuration admission's unrelated POSIX lock loss
      in the draft prepared source, with a strict before/after control.
- [x] Reproduce rejection of intentional backup/rebuild by permanent identity
      pins. Add a descriptor-relative transition guarded by per-database stable
      shared/exclusive leases; verify exact backed-up data, rebuilt database,
      refusal with local handles/live peers, and continued healthy peer writes
      in the pinned component and real SQLx. Actual CLI verification is pending.
- [x] Measure healthy operation overhead against the same unselected SQLite.
- [ ] Verify full native development, optimized, installed package and final
      image behavior. Before/after metadata checks do not by themselves provide
      atomic exclusion against uncoordinated external renames or fresh-process
      rollback protection; those wider requirements remain open.

## Recovery compatibility and experimental native gate

The current component matrix passes 1,031 controls: 64 healthy, 966 explicit
refusals with exact byte preservation, and a recovery-peer/local-handle summary.
It covers all seven databases and adds alias/replacement/permission attacks on
the seven stable authority leases. All 40 real SQLx controls pass, including
healthy backup/rebuild and refusal to replace a database with a checked-out
local connection. Before the transition was added, its strict healthy rebuild
control failed; the explicit negative control preserves that evidence.

Recovery takes an exclusive nonblocking per-database lease only after local
handles close. Cooperating peers hold the corresponding shared lease throughout
their process lifetime. Backup creation and all four file moves use retained
directory descriptors and no-replace renames under the native gate. The backup
files and directories are fsynced before the old identity pin is closed and the
lease is downgraded. Ordinary unselected recovery retains the upstream path.
This excludes cooperating peers, not an uninstrumented external writer.

The bounded component benchmark compares three alternating ordinary/selected
pairs against the same SQLite 3.51.3 source. The first implementation took
1,869–2,271 ms for 1,000 cached queries. Descriptor-relative direct-child lookups
and removal of duplicate metadata checks reduce that to 1,205–1,330 ms; ordinary
queries took 4–8 ms. Selected startup took 43–50 ms and 100 writes in one
transaction took 25–33 ms. These are unoptimized component measurements on this
container, not native CLI performance claims. Guard overhead remains material.

`probe-codex-native-sqlite-recovery.py` exercises actual app-server section
creation, process disposal, corruption of only state_5.sqlite, fresh private
configuration, native automatic backup/rebuild and subsequent reads/writes.
It requires the exact corrupt bytes in the backup, a valid rebuilt database and
retention of a sentinel in logs_2.sqlite. The preceding optimized CLI passes both
selected and ordinary compatibility controls. The first fixture assertion
incorrectly excluded built-in native sections; it now checks the requested
before/after names while preserving those sections.

The experimental workflow now requires the actual native retired-directory and
database negative controls, all pinned components, real SQLx, configuration lock
preservation and overhead measurements. It applies the draft before its final
development build and requires strict actual native refusal plus selected and
ordinary corruption recovery afterward. Existing migration, compression,
concurrency and auth checks remain. These gates have not run with this draft;
the production recipe and source inventory remain unchanged.

`probe-codex-native-sqlite-performance.py` adds two alternating ordinary/selected
pairs using the actual app-server protocol: startup and initial section creation,
25 verified section reads and ten verified writes per process. The preceding
optimized CLI passes all four finite runs. The new workflow preserves matching
before/after native measurements; no cross-machine timing threshold is inferred
from the component benchmark. The final fresh prepared draft has 44 changed/new
source files with inventory digest
`b6cef2e679e7f563c25a8b1e359816cf5ffd81109988894e47568dac127032a0`.

- [x] Fix probe cleanup after a refused native peer exits with buffered stdin;
      the reproducing unit test fails before the fix and all three process-group
      tests pass afterward. Accept only BrokenPipeError after the peer is reaped.
- [ ] Inspect the experimental full-native build and every new after control.
- [ ] Address any healthy-operation regression and measure full-native overhead.
- [ ] Add the verified source/flags to the release recipe and inventory, then
      require optimized x64/ARM64, actual installed package and both final images.

The three-peer native SQLite control keeps three actual app-server pools alive,
dispatches overlapping writes, verifies discovery from every peer, disposes one
private configuration, verifies survivor writes, and admits a fresh peer. Both
selector modes retain all 18 acknowledged sections and pass SQLite quick-check
against the preceding optimized CLI. The experimental workflow requires the
selected control before and after the guard and the ordinary control afterward.
This host-process check does not substitute for the required Docker lifecycle
matrix or prove full conversation storage.

## Selected startup fallback

The actual optimized CLI also sends a model request after native SQLite
migration fails. A minimal valid database containing only
`CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY)` reproduces native
`no such column: checksum`. The selected strict real-process control fails:
the healthy and unusable-schema cases both send one synthetic model request.
The ordinary control retains its existing fallback. These are confined actual
`codex exec` invocations, not an HTTP-client imitation.

The root cause is `codex-rollout::state_db::init`: it logs every runtime
initialization error and returns None, allowing execution without that state.
The draft `apply_sqlite_startup.py` refuses the selected Linux error branch
before returning. It writes a constant bounded diagnostic through nonblocking
stderr and calls `_exit(78)` to avoid native cleanup writers. Ordinary errors
and both healthy modes retain their prior behavior.

The exact extracted native init function fails its strict constructor-fixture
control before repair. All six controls pass afterward: both healthy modes,
ordinary fallback, selected refusal, a full diagnostic pipe and a missing stderr
descriptor. The fixture replaces the runtime constructor and libc declarations;
it executes the real error branch and Linux descriptor operations. It does not
prove full native execution or SQLx integration. The experimental workflow now
requires paired actual-CLI failures and strict after/ordinary controls; the
currently running `7d09cacbe` workflow predates this additional patch.

- [x] Reproduce selected native model execution after a SQLite migration error.
- [x] Verify actual ordinary behavior and the exact init function before/after.
- [ ] Verify the newly compiled CLI refuses before a model request.
- [ ] Include this policy in the admitted production inventory and every native
      release, installed-package and final-image control after native verification.
