# Native Codex auth-directory adapter experiment

This source experiment preserves native Codex commands while separating their
file credentials from configuration. It is **not installed by the images or
production launcher**. Canonical production projection, history, remaining credential/provider routes
and all-writer lifecycle coverage remain open.

The supported source is `openai/codex` tag `rust-v0.164.0`, peeled commit
`6aaac694803004a63c6f393d153c96d22521a6b9`. The annotated tag object is
`fe3b29455488c2e189e43ad5526a107900c5e1b7`; these are different Git objects.
`apply_adapter.py` refuses any other commit or source contexts. The source-pinned
compiler is Rust 1.99.1.

`CODEX_AUTH_HOME` selects a pre-existing absolute, private, owned directory.
`CODEX_HOME` continues selecting configuration. Missing/unsafe authority,
independent scoped auth files, and attempts to select keyring/auto/in-memory
fallback are refused. Internal ephemeral cleanup is an empty operation.
Without the experimental selector, the original native behavior is retained.
Explicit environment credentials are refused by the coordination patch.
Header credentials and custom-provider routes still need production authority
admission; the experiment does not establish coverage of every request path.

The file adapter anchors operations to an open directory descriptor; bounds
reads to 1 MiB; rejects linked, nonregular, shared-permission and multi-link
files; commits with a private temporary file, rename and fsync; and implements
native deletion/recreation. A stable descriptor lock primitive is included and
tested. The first build deliberately leaves native entrypoints uncoordinated;
atomic file replacement alone does not serialize refresh-token exchanges.

After all five actual-manager negative controls pass, `apply_coordination.py`
applies `coordination.patch` and installs `canonical_transaction.rs`. The patch
holds the descriptor lock across reread, exchange and commit, coordinates native
login/logout/identity updates, checks the predecessor again before persistence,
and invalidates managed cached reads even before token expiry. Account-grant
leases hold the same guard through their IdP exchange. Explicit environment
credentials and external auth are refused in this experimental canonical mode.
Waiters poll asynchronously for at most 60 seconds; a canonical token exchange
has a 45-second deadline. Cancellation/owner death closes the descriptor without
deleting its inode. Legacy mode retains its existing authority selection.

The patch is generated from the exact immutable source by
`make_coordination_patch.py`; the applier rejects changed managers and storage
modules before mutation. Local syntax, applicability and workflow checks pass.
CI run [40354283432](https://github.com/link-assistant/hive-mind/actions/runs/40354283432)
at `9689667ce9c6dae46e30302c362849b3614f7281` passes all five before/after
manager controls and builds the full native CLI. Native status, replacement,
logout, API-key reauthentication, peer reads and environment-key refusal pass.
The job completed at 2026-10-26 16:20:06 UTC. A bounded local compiler hit its
allocation limit in `codex-protocol`; CI supplied the build evidence. These
passes cover the named paths. Native cached snapshots outside `auth()` and
every credential/provider route still need audit before production integration.

The next source stage addresses a concrete remaining caller:
`model-provider/src/auth.rs` builds synchronous request headers using
`AuthManager::auth_cached()`, bypassing async `auth()` invalidation. CI first
requires stale synchronous reads on the coordinated intermediate build, then
applies `cached_reads.patch` and reruns every manager control. New controls
cover ChatGPT token replacement, logout, malformed canonical JSON and unsafe
file permissions. `make_cached_reads_patch.py` and `apply_cached_reads.py` pin
the exact intermediate manager hash. Native run
[40360472411](https://github.com/link-assistant/hive-mind/actions/runs/40360472411)
at `24ef9e65afed8a372df00f8f24190896dd00529b` passes all nine manager
negative/positive controls, seven storage tests and the full native CLI
build/status/replacement/logout/reauthentication/refusal probe. The job completes
at 2026-10-26 16:57 UTC; separate logs retain every before/after result.

This stage supports managed ChatGPT file auth and API keys only. Other stored
modes explicitly refuse admission in canonical mode. Synchronous reads perform
bounded file I/O and apply the manager's login/workspace restrictions without
starting a nested async runtime or contacting an identity provider. Refresh
retains a private pre-reload cache accessor for generation comparison, so a
waiter does not overwrite its predecessor snapshot before checking a peer's
commit. Production integration still requires the remaining route/history and
lifecycle audits.

The upstream release tag changes the workspace version while its lockfile
still records 166 local packages as 0.0.0. The applier repairs only those local
versions to 0.164.0 and checks exact before/after hashes. A parsed comparison
confirmed that every external dependency version, checksum, source and edge is
unchanged. Builds retain `--locked`; no registry update is accepted.

First reproduce the native missing-selector failure with the unmodified binary:

```sh
node experiments/issue-3785/probe-codex-native-auth-root.mjs /absolute/path/to/native/codex
```

Expected before repair: status exits 1 instead of reading the synthetic key
from the independent authority. The probe never inherits operator tool homes,
credentials or preload selectors and never makes an inference request. It uses
finite child deadlines, a 512 MiB data limit and a 16 MiB stack limit.

Compile and test the exact module independently:

```sh
rustc +1.99.1 --edition 2024 --test experiments/issue-3785/native-codex/canonical_auth_tests.rs -o /tmp/hive-canonical-auth-tests
prlimit --data=134217728 --stack=8388608 --core=0 -- /tmp/hive-canonical-auth-tests --test-threads=1
```

The tests use finite synthetic inputs and separate reaped processes. They cover
canonical replacement/logout/recreation, one predecessor consumption after a
locked reread, owner death without inode deletion, unsafe auth/lock files,
conflicting scoped copies and links, oversized inputs and lock replacement.
These are primitive tests, not evidence of coordinated native CLI refresh.

The dedicated `Native Codex auth adapter experiment` workflow builds the full
pinned CLI with this adapter and runs the native status/logout acceptance probe.
It also builds a small executable using the actual `codex-login` manager, with
two private configuration homes and a loopback rotating-token provider. Its
five explicit negative controls must establish stale cached replacement,
stale cached logout, duplicate predecessor consumption, and login/logout commits
while a refresh exchange is paused. Both processes must first load the same
generation. Startup/build failure cannot satisfy a control.
The workflow then rebuilds the same native manager with coordination and requires
both processes to pass each case, with exactly one predecessor exchange. The
login/logout writer must wait until that exchange finishes, then its write must
be the final canonical state. It builds the full coordinated CLI afterward and
checks native reauthentication, peer reads and refusal of an environment-key
override. All five original controls and the full-CLI probe passed in run 40354283432;
all nine controls and the same full-CLI probe pass in run 40360472411.
Its uploaded diagnostics preserve each negative and positive result separately.
It is an experimental build check; it does not certify or replace the required
six-tool release/deployment lifecycle matrix. Local full CLI compilation must respect the
container memory budget; use one compiler with debug data disabled and use an
adequately provisioned runner if a compiler is killed.

The actual model-request probe adds a stricter control than native status or
manager snapshots. Two live app servers warm a synthetic local provider, then
observe atomic G1 replacement, logout and G2 recreation in both API-key and
managed ChatGPT modes. Stock retains stale authorization after logout. The
source-built CLI from run 40370836766 observes replacement but sends a request
**without** authorization after logout. `--expect-unauthenticated-logout`
reproduces that intermediate defect using the downloaded CI executable.
Malformed and unsafe-permission controls reproduce the same fallback and
verify both live clients observe repaired G1 afterward.
`apply_request_auth.py` refuses missing canonical auth before an auth-required
provider can fall through to unauthenticated execution. Run 40376400046 compiles
the full native CLI and passes the actual-request positive control in both
auth modes with both live clients, including malformed/unsafe/logout refusal
and replacement/repair/recreation. The subsequent override extension below
still needs its own rebuilt positive control.
The downloaded intermediate CLI also reproduces eight independent provider
authority routes: environment key, inline bearer, unauthenticated provider,
explicit Authorization, extra key header, environment-derived key header,
organization and project environment selectors.
`--provider-overrides --expect-provider-overrides` requires each real local
model request to use the alternate synthetic authority, and verifies that the
stock version header and unset organization/project mappings retain canonical
G0. The extended patch rejects unsupported provider fields and custom headers
in canonical mode, retaining only those stock metadata declarations (identity
environment variables must be absent). Both ordinary and scoped auth resolution
perform admission before resolving bearer credentials. The positive
`--provider-overrides` run must observe zero model requests for all eight routes
and successful G0 requests for both stock metadata controls. Full native CI
verification remains pending.

The alternate native Bedrock constructors bypass that ordinary resolver.
`--provider-constructors --expect-provider-constructors` reproduces actual local
requests using the synthetic AWS bearer in both Bedrock implementations; setting
`requires_openai_auth=true` instead reproduces unauthenticated requests. All four
negative controls and four corresponding no-selector compatibility controls pass
against the downloaded intermediate CLI. The strict positive assertion fails
before repair because a G2 request is observed instead of zero requests.
The extended applier pins both auth and factory source hashes and validates the
provider before constructing any credential manager, AWS exporter, gateway or
remote catalog. Unsupported providers use an inert native provider that refuses
routing/auth and supplies only an in-memory catalog. The rebuilt full CLI must
pass all constructor refusal controls while retaining all four legacy controls.
That integration evidence remains pending. These cases do not certify gateway
login, agent-identity bootstrap or every other native endpoint and writer.
Remote plugins are disabled before startup, and every probe process group is
killed and reaped before temporary state is removed.

Native named-history controls also reproduce a separate private-config
dependency. After naming a thread and deleting its first configuration, fresh
native resume loses the name even with `CODEX_SQLITE_HOME` shared. The new
`CODEX_SESSION_INDEX_HOME` experiment routes native index scans, appends and
removal through one owned private directory and one stable OS lock. It rejects
private competing copies, links, unsafe permissions and changed lock identity;
rewrites use a unique synced temporary file and atomic rename. Five standalone
tests pass, including paused rewrite versus peer append and owner death without
lock deletion. `apply_session_index.py` pins the exact upstream index source.
Run 40376400046 compiles the full CLI, passes all 20 selected upstream/index
tests and verifies actual native name/read/resume and peer updates after both
private configurations are disposed. This is one history
component, not complete native history or production integration.

The exact upstream `rollout/src/maintenance.rs` has another private-state
dependency: compression and legacy migration take a lock beneath each
configuration's `.tmp`. Sharing rollouts alone permits two maintenance owners.
`probe-codex-native-maintenance.mjs` compiles that actual module with the pinned
compiler and reproduces both owners in separate bounded processes before the
repair, for normal release and forced owner death. The pinned applier adds
`CODEX_ROLLOUT_MAINTENANCE_HOME` without sharing the rest of `.tmp`. It retains
one canonical OS lock and an anchored directory descriptor, rejects private
competing locks, unsafe permissions, aliases, links, missing storage and
configuration overlap, and never deletes the lock inode. All 12 local controls
pass against the patched native function, including repaired authority and
legacy behavior without the selector. CI applies it before full CLI compilation
and selects it during named-history disposal tests. These controls verify lock
admission, not real concurrent compression/migration output or complete runtime
backing attestation; those lifecycle requirements remain open.

Native TUI prompt recall has a separate `history.jsonl` store. The pinned
`apply_message_history.py` experiment selects `CODEX_MESSAGE_HISTORY_HOME`
independently of private configuration. One stable OS lock protects native
metadata, single-row and batch reads and streamed, synced atomic appends.
The logical TUI identifier uses the stable lock inode, so atomic data-file
replacement does not invalidate every native cursor. Batch continuation keeps
row offsets but discards byte anchors across publications. Selected mode
refuses disabled/capped persistence, private competing histories, unsafe files,
links, missing/aliased/overlapping authorities and changed lock identities.
No selector preserves the upstream private-history behavior.

The small native public-API driver uses synthetic prompts and finite process
limits. Full native local compilation hit the 1 GiB compiler data limit while
compiling transitive Starlark; it was not retried unchanged. The focused unit
harness below compiles the exact native history modules with only the two
passive configuration value types stubbed. It reproduces split/lost private
history before repair and passes 14 positive controls afterward, including
eight concurrent appends, a waiting append after forced lock-owner death,
141-row native batch pagination, replacement/recreation and unsafe storage.
All 12 upstream history tests pass in that focused harness. This is distinct
from full native integration: CI builds the real crate before/after the patch,
runs the same controls and upstream tests, and includes the patch in the full
CLI. Those new CI results remain pending.

```sh
python3 experiments/issue-3785/native-codex/build_message_history_focused.py /absolute/native/source /tmp/new-empty-history-harness --test
node experiments/issue-3785/probe-codex-native-message-history.mjs /tmp/new-empty-history-harness/target/debug/hive-message-history-probe
```

The TUI currently converts some metadata/read failures to empty results and
logs append failures while continuing. Application-level refusal before
authenticated execution, all-writer crash/publication semantics, backing
attestation and production integration remain open; these storage controls
do not establish those acceptance criteria.

The actual TUI has a separate publication-order defect: it queues a model turn
before its asynchronous prompt-history append and only logs persistence errors.
`probe-codex-native-tui-history.py` drives the real terminal with bounded PTY
input and a synthetic loopback model. The earlier downloaded native executable
passes the healthy input/request control, then fails strict refusal for unsafe
selected history. The canonical-history CLI is checked again before the repair
in CI, so passing lower-level storage tests cannot conceal this application path.

`apply_tui_message_history.py` pins five full source hashes. It sends the native
mention-aware history text and operation together, awaits canonical publication,
and forwards the turn through the existing command handler only after success.
An image-only prompt validates selected storage without adding an empty row.
Selected direct/missing-thread paths refuse; absent selection preserves native
asynchronous persistence. The actual full CLI before/after/legacy controls are
required in CI. Local applicability, rustfmt, 14 history controls and 12 upstream
tests pass in the focused harness; full patched TUI compilation and execution
remain pending. Other operation paths, read-error propagation, complete writer
semantics and production integration remain open.

The refresh crash probe kills a real native CLI after the synthetic provider
consumes G0 and before any response or credential publication. The intermediate
CLI reproduces a peer reusing that consumed predecessor despite correct OS lock
release. `apply_refresh_intent.py` records and syncs a bounded predecessor digest
before the exchange. Unknown outcomes retain the marker and refuse another G0
exchange or model request. A durable new generation can reconcile the marker;
changing only JSON formatting or refresh metadata cannot do so. Successful
responses that retain their refresh token clear the marker after durable commit.
Storage owner-death controls pass locally. Full CLI before/after validation is
required by the native workflow and remains pending for this recovered stage.

An added seven-test transaction harness found a recovery dead end: safe malformed
credential JSON after an uncertain refresh blocked even explicit native login's
lock acquisition. Reconciliation now preserves the marker while allowing the
lock owner to replace the malformed JSON. Reads and refresh still refuse it;
unsafe files and malformed markers still fail admission. The failing regression
and passing exact-module results are retained as `native-refresh-repair-before.log`
and `native-refresh-repair-after.log` in the case-study evidence. The real CLI
`--repair-malformed` control must also pass in CI; module checks are not a
substitute for that integration result.

For bounded local checks, build only the small locked dependency crate below,
then run the same harness against the actual patched source. Its direct JSON,
hashing and Tokio versions match the immutable native lockfile. It intentionally
omits the full CLI dependency graph, which still compiles in the native job.

```sh
CARGO_BUILD_JOBS=1 cargo +1.99.1 build --locked --manifest-path experiments/issue-3785/native-codex/transaction-dependencies/Cargo.toml --target-dir /tmp/hive-native-transaction-deps
python3 experiments/issue-3785/native-codex/build_refresh_transaction_tests.py /absolute/native/source --dependencies-dir /tmp/hive-native-transaction-deps/debug/deps
```
