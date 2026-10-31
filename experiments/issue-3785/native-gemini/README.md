# Native Gemini credential read experiment

This patches a disposable copy of Gemini CLI 0.65.0. The source tag points to
commit `6006c14a4decfe4b891c6263ad6ad5992e404b5b`; the inspected OAuth manager
bundle has SHA-256
`4d9cf6435503e5280ecb0f55078793531c8041fe435f60fa8dfce92317c8a28e`.
The package version and exact manager bytes must match before mutation. The
strict credential reader is reused from the existing Qwen experiment and is
also pinned by its hash. Production launchers/images do not install this stage.

The actual `getOauthClient()` caches a promise by auth type. Both later factory
calls and retained Google OAuth clients keep their in-memory credentials after
atomic replacement or logout. Nine bounded synthetic controls reproduce stale
G0 request headers after replacement, logout/recreation, malformed JSON, unsafe
permissions, symlink, hard link, directory, oversized input and parent replacement.
The strict native replacement test fails with G0 instead of G1.

The selected experiment uses `GEMINI_AUTH_HOME` for one existing private owned
credential directory, independently of `GEMINI_CLI_HOME` configuration. Each
factory read, native access-token read and request-metadata operation rereads
canonical storage. Existing private credentials, changed authority selection or
directory identity, explicit alternate credentials and unsupported auth types
refuse. Retained clients clear their credential cache on refusal. The reader
anchors a no-follow, nonblocking file open to a checked directory descriptor,
requires a private owned regular file with one link, bounds input to one MiB,
and validates file and parent identities before and after reading.

This first stage deliberately **refuses expired credentials, refresh, login
publication, logout and revocation**. It removes the unawaited native token-write
listener from selected clients and refuses native cache/clear entrypoints before
mutation. Coordinated native writers, all other provider constructors and retained
legacy handles still need implementation and testing. This is not a usable
production authentication adapter or completion of the six-tool contract. Native
no-selector behavior remains available and is checked separately.

The probe imports the actual native manager bundle and adds only a dependency
export so token verification/user-info can be stubbed. Unexpired controls exercise
the real factory, credential state and Google request-header methods; they never
send a model request. A refusing refresh-transport stub counts attempted exchanges;
all repaired controls require zero attempts. Every child has a 256 MiB V8 heap,
2 GiB data-address bound, 16 MiB stack, 64 KiB output bound and 20-second deadline.
Process groups are killed and reaped before fixture removal. Startup failure
cannot satisfy a stale-header control: each worker first produces a native G0
header successfully.

```sh
npm ci --prefix experiments/issue-3785/native-gemini/stock-cli --ignore-scripts --omit=optional --no-audit --no-fund
export GEMINI_PROBE_MODULE="$PWD/experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli/bundle/chunk-DKZARV6U.js"
node experiments/issue-3785/probe-gemini-native-reads.mjs --expect-native-gaps
# This strict command must fail before repair, showing G0 rather than G1.
node experiments/issue-3785/probe-gemini-native-reads.mjs
python3 experiments/issue-3785/native-gemini/apply_reads.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --check
python3 experiments/issue-3785/native-gemini/apply_reads.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli
node experiments/issue-3785/probe-gemini-native-reads.mjs
node experiments/issue-3785/probe-gemini-native-reads.mjs --private-configs --refusal-controls
node experiments/issue-3785/probe-gemini-native-reads.mjs --without-selector --expect-native-gaps
```

The independent-root fixture verifies no private auth file is created, canonical
reads survive configuration disposal, and adding a competing private credential
file causes refusal. The read-stage writer controls preserve G0 and make zero
refresh attempts. Full conversation history requires separate native storage
work: the upstream runtime directory also contains executable/configuration
material, so projecting the entire Gemini home/runtime would violate isolation.

## Coordinated writer stage

`apply_coordination.py` builds on the exact read stage. It reuses the inspected
Qwen transaction engine through `native-oauth-transaction.mjs`, with separate
Gemini intent names and refresh-token hash domains. The shared lock inode stays
stable; credential reads, refresh exchange, publication and logout run under its
kernel lock. The lock is released before inference. No process-lifetime lock is
used. The canonical directory identity also remains bound across a rejected
factory initialization and later retries.

The stock native client emits tokens to an unawaited writer, then overwrites a
provider's rotated refresh token with the cached predecessor. The bounded native
direct-refresh regression reproduces G0 surviving where G1 must persist. The
coordinated stage captures the real native exchange, removes its asynchronous
writer, awaits atomic file/directory synchronization, and sets published state
before returning to native wrappers. Missing provider refresh tokens retain the
current one. Native refresh HTTP retries are disabled for selected authority,
because a lost response cannot justify exchanging that predecessor again.

Twenty-six process controls exercise simultaneous refresh, pending cache publication
and logout, owner death, network refusal, metadata-only rewrites, root replacement
after failed initialization, invalid grant, non-rotating refresh, direct refresh,
direct no-cache refresh and a competing external publication. Cold readers make
zero exchanges after an uncertain outcome. Republishing the uncertain predecessor
refuses; a distinct login generation repairs storage and supports a new factory
call in the same process. A regression first failed because the native factory
cached its rejected promise; selected failed initializations now remove only
their own promise from the map. A separate before/after control prevents that
retry from silently accepting a replaced authority directory.

```sh
python3 experiments/issue-3785/native-gemini/apply_coordination.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --check
python3 experiments/issue-3785/native-gemini/apply_coordination.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli
node experiments/issue-3785/probe-gemini-native-writers.mjs
node experiments/issue-3785/probe-gemini-native-reads.mjs --private-configs
```

Authorization-code exchanges use the native SDK and its real HTTP option
construction, with retries disabled. A checked pre-exchange snapshot prevents
publishing into a competing generation. A new login must provide its own complete
refresh generation, including when repairing a previous uncertain exchange; it
cannot inherit another account's refresh token. Unsafe legacy intent refuses
before a code exchange.

An explicit interactive factory call with missing credentials reuses the native
manual-code or browser login flow. Only missing credentials qualify: malformed
or otherwise unsafe existing storage refuses before browser launch or exchange.
Noninteractive readers still refuse missing credentials. The manual control
feeds the real terminal prompt. The browser control exercises the native local
HTTP callback and generated state, replacing only the external browser-launch
operation and provider transports. Neither control opens a live Google session.
A fresh native peer requires the durably published generation in both cases.

Native revocation rereads current storage, rejects an explicitly stale token,
and durably removes local credentials before sending the no-retry revocation
request. Success and network-refusal controls both require subsequent readers
to refuse; a failed provider response cannot resurrect local credentials.

## Canonical account metadata and callbacks

The next stage moves native `UserAccountManager` reads, writes, path reporting,
account counts and logout into canonical `google_accounts.json`. The native
manager previously wrote that file into each private configuration directory.
The strict regression fails with the canonical file missing. Cached-login
callbacks also failed after the first read-only adapter; a separate actual
native control reproduces that omission.

The synchronous native getters use bounded descriptor-anchored, no-follow reads
with file/directory identity, ownership, mode and link checks. Writes use the
credential transaction lock and awaited atomic publication with file/directory
synchronization. Metadata carries a refresh-generation hash; delayed user-info
responses require matching current access and refresh credentials before
publication. A different account retains the prior account in the lifetime count.
Logout clears the active account while retaining that count. Unsafe canonical
metadata and competing private account files refuse without copying either.

Cached login, refresh and authorization-code publication preserve native
post-auth callbacks after durable publication. Callback credentials and account
metadata are read under the same credential lock. Initial manual/browser flows
retain their native callbacks. A further regression demonstrated that selected
logout left the factory promise cached and prevented login in the same process.
Logout and revocation now clear that cache; both initial-login-after-logout
controls exercise the real manual-code flow again.

The inspected native cache-publication control is still distinguished from the
interactive flows. The expanded account stage has 41 native writer/login/account
controls. Full CLI inference, full conversation storage and production installation
remain open; the constructor/request stage below is a separate experiment. One control keeps an actual native OAuth client model request pending while
a second process reads G1, proving the credential lock is released during that
request. Its model transport is synthetic. These tests do not establish live
provider replay/grace behavior or the complete six-tool contract.

## Native config, constructor and request admission

`apply_request_auth.py` requires the exact coordinated manager hash
`d7770e02fce0af146f78d6f509c83c53de8f0a5eb2933d6956707291ff3a8c9d`
and checked reader/writer helpers. It adds admission to the public native config
factory, content-generator constructors, OAuth factory and Code Assist request
dispatch. The resulting manager hash is
`c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792`.

The strict original constructor control fails after an actual Google SDK model
request using a competing API key despite selected OAuth. Thirty bounded native
controls reproduce that route and other config/header/endpoint/client bypasses,
while preserving existing environment-key, selector-change and logout refusals.
After admission, selected config/constructors refuse API-key, Vertex, ADC and
gateway authority before private credential discovery. OAuth config also refuses
explicit keys, competing shadow environment, alternate URLs and credential
headers. Code Assist POST, GET and streaming dispatch validate the admitted
native client, current canonical credentials, default endpoint and headers.
Non-authentication trace headers remain usable. The process binds the selected
root; unsetting it cannot enable a subsequent competing constructor.

All 30 selected request controls and 30 unselected compatibility controls pass
locally. Each retained-handle control first completes a healthy actual native
G0 dispatch. Canonical replacement then dispatches G1; unsafe changes make zero
additional provider requests. The native API-key SDK control executes its real
public `countTokens` implementation with only the external fetch replaced.
The combined writer/account/read controls are rerun after this stage.

```sh
node experiments/issue-3785/probe-gemini-native-request-auth.mjs --expect-native-gaps
# This strict constructor regression must fail before admission.
node experiments/issue-3785/probe-gemini-native-request-auth.mjs --scenario=constructor-api-key
python3 experiments/issue-3785/native-gemini/apply_request_auth.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --check
python3 experiments/issue-3785/native-gemini/apply_request_auth.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli
node experiments/issue-3785/probe-gemini-native-request-auth.mjs
node experiments/issue-3785/probe-gemini-native-request-auth.mjs --without-selector
```

These module/SDK controls do not establish full CLI inference, arbitrary
pre-existing clients, canonical API-key/ADC backends, conversation storage or
production installation. Unsupported selected backends refuse; implementing
their own canonical authority remains open.

## Actual CLI request control

`probe-gemini-native-cli.py` runs the complete pinned CLI after all three
adapter stages, with no native export or SDK instrumentation. A loopback proxy
terminates TLS using a fixture CA trusted by Node; it never forwards traffic.
The actual native OAuth token verification, account lookup, Code Assist setup
and streaming model request must complete successfully. The model response,
credentials and account are synthetic. Canonical credentials remain unchanged,
canonical account metadata is published, and neither credential nor account
files appear in private configuration.

```sh
python3 experiments/issue-3785/probe-gemini-native-cli.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --diagnostics /tmp/gemini-cli-healthy.log
python3 experiments/issue-3785/probe-gemini-native-cli.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --history --expect-history-gap --diagnostics /tmp/gemini-cli-history-before.log
# This strict full CLI history regression fails before canonical storage.
python3 experiments/issue-3785/probe-gemini-native-cli.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --history --diagnostics /tmp/gemini-cli-history-regression.log
```

The control passes locally on Node 26.12.1. CI runs Node 24 and must verify that
runtime separately. Children have a 256 MiB V8 heap, 2 GiB data-address bound,
16 MiB stack, 45-second deadline and 256 KiB diagnostics limit. Provider request
count/body size and socket waits are bounded. The fixture reaps process groups
before successful cleanup and retains failed fixtures. The accompanying network
trace records operations without credential headers or request content.

The history control first requires successful native completion and a real
persisted transcript. After reaping the whole native process group, it deletes
the fixture-owned private home and starts a fresh peer. The existing adapter
then lists no sessions and refuses resume with the native missing-session
diagnostic, making no second model request. The strict regression fails at
canonical conversation discovery. It cannot pass from an arbitrary startup or
provider failure.

This verifies one healthy full CLI OAuth inference. Full CLI concurrent refresh,
owner-death recovery, alternate backends and production installation remain open.

## Canonical conversation stage

`apply_history.py` requires the exact constructor-stage manager plus four pinned
native CLI/helper inputs before writing any file. It adds `GEMINI_HISTORY_HOME`
independently of private configuration and auth. The resulting manager hash is
`0c70897032c0ad76419b3149d783567280dfd972ef2c04e258cbebccc9575c42`.
The original installed package remains unchanged; only disposable copies run.

The selected root is a private, owned, existing directory. Canonical
`projects.json` maps each real project path to its SHA-256 directory, with native
conversations under `projects/<hash>/chats`. Native transcript and summary
readers/writers use bounded descriptor-anchored reads, single-link regular files,
stable kernel locks, synchronized append and atomic publication. Rewrites retain
the preceding generation and refuse a stale observed digest after another
process publishes. Root/child replacement, changed selectors, links, unsafe
permissions and files above 32 MiB refuse. Configuration, tools and executable
material stay in private homes.

```sh
python3 experiments/issue-3785/native-gemini/apply_history.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --check
python3 experiments/issue-3785/native-gemini/apply_history.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli
python3 experiments/issue-3785/probe-gemini-native-history-storage.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --diagnostics /tmp/gemini-history-storage.log
python3 experiments/issue-3785/probe-gemini-native-cli.py experiments/issue-3785/native-gemini/stock-cli/node_modules/@google/gemini-cli --history --diagnostics /tmp/gemini-cli-history-after.log
```

The full CLI control now lists the saved session from a fresh private home and
resumes with the prior user prompt and model response in its next real native
request. Native listing also generates a summary through the synthetic provider;
the assertion distinguishes that operation from the two conversation requests.
Symlink/hardlink and malformed/truncated variants first persist a healthy native conversation, then
require fresh-peer refusal before another inference and preserve the protected
file's bytes and inode. Unselected history retains the original private behavior.
These full CLI controls use the real native parser and SDK without export or
transport instrumentation; only external provider responses are synthetic.

Nineteen separate storage controls cover a healthy rewrite, sixteen unsafe/changed
states, four independent writers preserving all 40 records, and a stale rewrite
preserving all 50 records after a peer append. Each worker has a 128 MiB V8 heap,
2 GiB data bound, 16 MiB stack, 64 KiB output bound and a 20-second deadline.
The probes reap process groups before cleanup and retain failing fixtures.

Two additional full CLI regressions reproduce silent malformed/truncated record
handling before validation. Merely rejecting the read was insufficient: native
retention cleanup caught the error and unlinked the rejected transcript. The
selected CLI listing/cleanup boundary now rechecks the failed authority before
treating a read error as a disposable session. JSON/JSONL reads and writes
validate every record before publication; invalid appends/rewrites preserve the
preceding bytes. The seven full CLI unsafe-history controls require the canonical
entry and protected outside file to retain their bytes and inodes, with no
additional inference. The native loader also validates the parsed session UUID, project hash and
message list. Missing metadata, a foreign project hash and an invalid session ID
refuse before cleanup or another inference.

The next local stage reproduces valid startup-only and expired records being
unlinked by automatic retention. Explicit `--delete-session` also reports success
while its core writer still targets private storage. Selected retention and
deletion now use the canonical chats directory and atomically rename records into
its `.archive` directory, synchronizing both directory descriptors. Native active
listing behavior remains intact; the audit record retains its bytes and inode.
Cleanup does not remove associated canonical subagent records. Archive discovery/
resume and complete artifact lifecycle support remain unfinished.

A second full CLI regression holds the owner's model response while a peer runs
retention. Archiving that live file leaves the next owner append without its
preceding metadata. The actual native writer now holds a per-conversation kernel
lease through its lifetime. Retention skips a busy record and explicit deletion
reports that it is being written. Other conversations use independent leases;
the global storage transaction lock is not held during model inference. Lease
replacement or links reject further writes, and kernel ownership releases when
the process dies.

All five full CLI retirement controls pass locally: empty and expired records,
explicit deletion, live-peer retention and live-peer deletion. The live controls
preserve the existing record prefix and inode while permitting legitimate owner
appends. Twenty-nine bounded storage controls now also cover archive preservation,
stale archive refusal after a peer append, unsafe archive/lease paths, independent
writers and recovery after owner death. All surviving generations remain intact.

A further local archive stage first reproduces exact-UUID resume and native
archive discovery failing after successful inference, explicit deletion and
private-home disposal. The selected CLI now exposes `--list-archived-sessions`
for the current canonical project. It enumerates at most 1024 directory entries,
validates private regular single-link files and uses the actual native parser.
Discovery leaves every retired record archived and makes no model request.
Exact-UUID resume selects the latest native generation and publishes a separate
active record while preserving archive bytes/inodes. The retained conversation
lease excludes a second native writer before another inference.

Two bounded publication barriers also reproduce an append into a concurrently
created file and restoration replacing a new active file. Missing-file appends
now use exclusive creation; new publications use an atomic non-replacing link
before removing their temporary name. Forty-one storage controls pass locally,
including protected active records, stale/malformed/linked archives, replaced
archive directories, wrong projects, subagents and bounded enumeration. Seven
full CLI archive attacks refuse before another inference while preserving both
canonical and protected-file bytes/inodes. The healthy full CLI discovers and
resumes archived user/model content after private-home disposal, and a concurrent
peer refuses the live resumed writer. A second archive/delete cycle discovers
all retained generations, including startup-only records, and resumes the latest
conversation with both earlier prompts and the prior model response. Every
archived generation retains its bytes and inode. Optional `GEMINI_HISTORY_DEBUG=1` prints
only helper source locations on the first refusal; it is disabled by default.

The retirement stage passes Node 24
[CI 41116035148](https://github.com/link-assistant/hive-mind/actions/runs/41116035148)
on `4a6be5dfb30e1ae122a183ef744400f6af41cab2`: native CLI discovery/resume,
seven unsafe active-record controls, five retirement controls, 29 storage controls
and all authentication regressions. Archive discovery/resume and the expanded
41-control storage stage pass locally on Node 26.12.1 and need fresh Node 24 CI.
Native imports, complete artifact/subagent lifecycle, other history writers,
Git/checkpoint/prompt/shell history, interrupted writes and production installation
remain unfinished. Complete archive indexing, child archives and power-loss
recovery also remain open. Sharing only conversations does not complete the
full-history requirement or the six-tool authority contract.

The native `--session-id` parser also accepts alphanumeric IDs with dashes and
underscores. A compatibility control first completes with such an ID before the
conversation stage, then reproduces its rejection by UUID-only canonical
admission. Canonical parsed-record admission and exact archive lookup now use
the native identifier alphabet. The complete CLI discovers, deletes, lists the
archive and resumes `SYNTHETIC_NATIVE_SESSION-3785` after private-home disposal.
Numeric JSON session metadata still refuses; this preserves valid native strings
without admitting an invalid metadata type.

## Explicit native session import

The native `--session-file` route originally reads outside the selected loader's
registered project and writes its destination through an independent filesystem
path. The strict control first completes inference and saves a real native
conversation, then reproduces import refusal. The selected import route now
reads an explicit source through a checked parent descriptor, validates every
JSON/JSONL record and runs the actual native parser. Its source must be an owned
private regular file with one link, at most 32 MiB, in an owned private directory.
Linked parents, changed file/directory identity, unsafe permissions and mutation
during parsing refuse before canonical publication or inference.

Native import still assigns a new session ID, rewrites the project hash for the
current project and applies its existing message filtering. Publication uses
the canonical writer lease and an exclusive private file; the source remains
unchanged. Canonical records, private JSONL exports from another project and
legacy JSON exports all pass full CLI import/disposal/discovery/resume controls.
The third model request contains both preceding prompts and the prior response.
Nine unsafe-source CLI controls and 45 bounded storage controls pass locally,
including changed/replaced import sources and parent replacement during parsing.
The import/archive/native-ID stage passes Node 24
[CI 41121912110](https://github.com/link-assistant/hive-mind/actions/runs/41121912110)
on `946ed6e82e07426dbe6ebd224c7675796dcbe339`, including all 41 writer/account,
30 request and 11 read controls. Other history writers,
artifact/subagent lifecycle, interrupted publication and production installation
remain open.

## Canonical tool-output artifacts

`apply_artifacts.py` builds on the exact conversation stage. A strict full CLI
control first runs the real shell tool, offloads about 25 KiB of finite output,
and completes inference. Removing the private home then reproduces loss of the
full output referenced by the retained transcript.

The selected artifact stage registers each private project temporary directory
against its canonical project. Native truncation and both masking writers
publish separate immutable 0600 files in owned 0700 project/session directories.
Names contain a content digest and a unique identifier; publication cannot
replace an existing file. The file and containing directory are synchronized.
References use the stable canonical path, so another process can read them after
private-home disposal. Native `read_file` grants only registered-project artifact
reads and uses checked descriptor snapshots with strict UTF-8 and digest
validation. Its existing text formatting and line selection are preserved.

The full CLI control resumes in a fresh private home, reads the old output with
the real `read_file`, and sends its middle content to the local synthetic
provider. Original bytes and inode remain unchanged. Eight native unsafe-output
controls refuse linked, missing, oversized, permissive, corrupt, changed-content
and replaced-parent inputs before any further model request. There are 65 bounded
storage controls. `probe_artifacts.py` exercises the actual native truncation and
both masking implementations with finite input and export-only instrumentation;
its nine controls check disposal, unsafe storage, ordinary text/line formatting and unselected
private behavior. Model transports remain covered separately by the full CLI
control, which does not instrument native exports.

```sh
python3 experiments/issue-3785/native-gemini/apply_artifacts.py /path/to/disposable/gemini-cli --check
python3 experiments/issue-3785/native-gemini/apply_artifacts.py /path/to/disposable/gemini-cli
python3 experiments/issue-3785/native-gemini/probe_artifacts.py /path/to/disposable/gemini-cli --diagnostics /tmp/gemini-artifact-writers.log
python3 experiments/issue-3785/probe-gemini-native-cli.py /path/to/disposable/gemini-cli --history --history-tool-output --diagnostics /tmp/gemini-artifact-cli.log
```

This stage still requires native CI. Degraded blobs, other history surfaces,
artifact garbage collection, subagent lifecycles, interrupted publication,
backends and production installation remain open. Nothing projects the private
runtime directory or executable/configuration material.

## Strict history text decoding

Bounded active-read, import and read-before-archive controls reproduce invalid
UTF-8 being silently converted to replacement characters before JSON parsing.
The selected snapshot reader validates the complete byte sequence before
decoding. Refusal preserves the source bytes and inode. A positive control
retains Japanese text, accented text, emoji and a literal replacement character
through rewrite, read, archive and explicit import. The 49 strict-decoding and
conversation controls pass locally and remain in the expanded 65-control
artifact stage; the existing native CI job runs the complete set.

## Canonical degraded multimodal blobs

`apply_blobs.py` builds on the exact artifact manager. Its strict before control
first offloads a real one-pixel PNG through the native degradation processor and
reads it with the native file-content implementation. Removing the private home
then loses the referenced binary file and fails the lifetime assertion.

The selected processor publishes raw bytes in separate immutable canonical
project/session files. It bounds base64 input before decoding, retains an ASCII
MIME type of up to 96 bytes in the filename, and uses the same checked descriptor, exclusive
publication, file/directory synchronization and content-digest checks as tool
outputs. A registered project is required for native reads. Unsafe paths refuse
without a private fallback. External file references keep their URI and do not
produce a local copy. No executable or configuration directory is projected.

All 31 finite native controls pass locally: 24 writer/reader controls and seven
fresh-process reads after private-home disposal. Valid uppercase MIME types and
unpadded base64 retain their original bytes and read back as `image/png`.
JSON, SVG, UTF-16 and text stored under an audio MIME retain native classification,
BOM decoding and text formatting. A strict regression reproduces the earlier
adapter's text loss before the checked-buffer repair. Controls reject malformed
base64 (including padding-only input)/MIME, non-ASCII MIME, linked or permissive
storage, changed or oversized content, missing/replaced parents, foreign projects,
traversal and publication collisions. Protected data and competing publications
remain unchanged. Unselected native private-storage behavior also passes.

```sh
python3 experiments/issue-3785/native-gemini/apply_blobs.py /path/to/disposable/gemini-cli --check
python3 experiments/issue-3785/native-gemini/apply_blobs.py /path/to/disposable/gemini-cli
python3 experiments/issue-3785/native-gemini/probe_blobs.py /path/to/disposable/gemini-cli --diagnostics /tmp/gemini-blob-controls.log
python3 experiments/issue-3785/probe-gemini-native-cli.py /path/to/disposable/gemini-cli --history --history-blob --diagnostics /tmp/gemini-blob-cli.log
```

These controls add exports to a disposable copy of the actual native module;
the separate full CLI control does not instrument native exports. It first
executes native image reading and context degradation, completes inference and
reproduces the precise lifetime failure before repair. After repair, a fresh
CLI resumes with the original workspace image removed and sends the retained
PNG in a new `read_file` response. An image in earlier transcript content cannot
satisfy this assertion. Seven unsafe-blob CLI controls pass, refusing before
another model request and preserving protected bytes/inodes. The complete
CLI tool-output resume and its eight refusal controls also run on this manager.
Node 24 CI run 41132983002 passes this exact artifact/blob stage at
`d0b4f6b4701f018b2f0d2d577dd8183bed3f12e3`, including the complete CLI
controls and 41/30/11 authentication regressions. Complete artifact/subagent
lifecycle, other history surfaces, interrupted publication, all backends and
production integration remain open.

## Native Logger prompt history and named checkpoints

`apply_logger.py` builds on the exact blob manager and intercepts the exported
native `Logger` methods. Strict before controls first write and read a prompt or
named checkpoint successfully, then reproduce loss in a new native process after
private-home disposal. A third control reproduces an initialized Logger returning
cached prompts after a peer writes a new message.

The selected implementation keeps data in a separate canonical project
`message-history` directory. Prompt reads reload the checked UTF-8 snapshot.
Appends hold a stable kernel lock across reread, schema validation, assignment of
the next session message ID and synchronized publication. The serialized schema
is checked again before publication. Each file is bounded to 32 MiB and 100,000
records. A pre-publication generation check refuses replacement while the staged
version is being flushed; protected and replacement files remain unchanged.
Storage errors propagate from the native method without a private fallback.

Named checkpoint saves and deletions append to a checked event journal under the
same transaction. Load and existence checks use its latest event; deletion keeps
all earlier checkpoint generations for audit. Recreation adds a further event.
Native array checkpoints and objects containing a history array remain readable.
Tags are bounded UTF-8 data, including separators, rather than path components.
Configuration and executable material stay private.

All 30 scenarios pass locally, producing 36 bounded native process results:
fresh-process prompt/checkpoint reads, next-read peer visibility, four concurrent
writers preserving all 40 prompts and unique IDs, checkpoint generation retention,
unselected behavior, and 24 unsafe-storage/publication controls. These use the
actual exported Logger and Storage without adding native exports. The finite
replacement and I/O-failure controls instrument filesystem calls. They establish
the inspected native API behavior, not complete interactive UI admission.

```sh
python3 experiments/issue-3785/native-gemini/apply_logger.py /path/to/disposable/gemini-cli --check
python3 experiments/issue-3785/native-gemini/apply_logger.py /path/to/disposable/gemini-cli
python3 experiments/issue-3785/native-gemini/probe_logger.py /path/to/disposable/gemini-cli --diagnostics /tmp/gemini-logger-controls.log
```

Logger-stage manager SHA-256:
`439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b`.
History helper SHA-256:
`b3d5662d58bec0036c7350bdb8b498f1edec892942131beaf7189eab3680a8ab`.

Node 24 CI run 41137763744 passes at
`8f2ec5c8e5118f4a135681810108048519cea19c`, including these Logger controls and
the publication controls below; its log and all 586 diagnostic files are retained.
Interactive startup/error admission, prior-private-state
migration, shell command history, Git checkpoints, plans/tracker/task state,
child/subagent lifecycle, interrupted first publication, all backends and
production installation remain open. This experiment does not complete A1–A12.

## Interrupted first publication

The preceding helper can die after linking synchronized staging bytes into the
canonical name and before removing the staging link. A fresh checked reader then
refuses the resulting two-link file. `probe_publication.py --before-control`
reconstructs that exact preceding helper only in its disposable native package;
its SHA-256 must equal
`b3d5662d58bec0036c7350bdb8b498f1edec892942131beaf7189eab3680a8ab`.
Strict controls reproduce this refusal for the project registry, native Logger
prompts and named checkpoints, tool outputs, and degraded blobs. They first
confirm complete synchronized data, kill and reap the owner, dispose its private
home, and require a fresh process to retain the original bytes/device/inode.

The new `publication.mjs` records an exclusive, synchronized 0600 journal before
first publication. The journal identifies the allowlisted destination, staging
inode/device, size and SHA-256. The same stable history lock protects publication
and recovery. Before ordinary reads/writes, recovery verifies the bounded UTF-8
journal, data identities and content, then completes or finalizes that specific
publication. It never overwrites a competing destination. The canonical data inode
is retained while the staging link and completed journal are removed and their
parent synchronized. Unrelated hardlinks continue to fail ordinary admission.

The controls cover three forced-death points for all five families: after durable
intent but before linking, after linking, and after staging-link removal. Twenty
unsafe-evidence cases cover linked, permissive, malformed, oversized, invalid
UTF-8, traversal and mismatched journals; linked, permissive, changed or missing
staging; and linked, permissive, changed or competing destinations. Refusal keeps
all publication and protected files unchanged. A further live replacement
regression first fails on the draft, then verifies refusal before canonical
publication while retaining the original stage, protected intent and peer
journal. Failed operations retain their unpublished staging/evidence.

The journal is limited to 4096 bytes, data to 32 MiB, and each locked directory
scan to 16,384 entries and 128 pending journals. Data hashing uses a 64 KiB buffer.
Each native process has a 192 MiB JavaScript heap, finite 20-second deadline,
16 MiB stack and 64 KiB diagnostic cap; all descendants are reaped. Storage and
Logger initialize through the actual native exports; artifact/blob crash reads
use the installed adapter's public helpers. These controls do not establish full
CLI crash admission or physical power-loss recovery.

```sh
python3 experiments/issue-3785/native-gemini/probe_publication.py /path/to/disposable/gemini-cli --diagnostics /tmp/gemini-publication.log
python3 experiments/issue-3785/native-gemini/probe_publication.py /path/to/disposable/gemini-cli --attack journal-symlink --diagnostics /tmp/gemini-publication-unsafe.log
python3 experiments/issue-3785/native-gemini/probe_publication.py /path/to/disposable/gemini-cli --live-journal-replacement --diagnostics /tmp/gemini-publication-live.log
```

Manager SHA-256 remains the Logger-stage `439a87bb...` above. Recovery-stage
history helper SHA-256:
`8102dc907fd4c61e91cef33daa6debd291a5620a24cd3f53bd355350706fca41`.
Publication module SHA-256:
`2e55f93d5075a6c9cc9d5b3c7e71f243accc8f72e955e038d0341cb8fed0bc00`.

Malformed/incomplete intent creation, unjournaled staging, append interruption,
complete CLI/UI admission, migration, all other history surfaces, child/subagent
lifecycle, alternate backends, power loss and production installation remain
open. Invalid or conflicting evidence is retained and refused; this stage does
not provide an automatic repair for every interruption or complete A1–A12.

## Interactive shell command history

The inspected native `useShellHistory` hook caches a private `shell_history`
file, rewrites it asynchronously and swallows write errors. Three strict
controls reproduce command loss after private-home disposal, cached navigation
after a peer write, and submission returning despite failed persistence. Each
starts with a healthy command write/read. The lifetime control requires the
specific fresh-reader failure; an unrelated startup error cannot satisfy it.

`apply_shell_history.py` patches only the exact interactive bundle and adds a
separate data helper. Selected paths register a project selector without opening
the private file. Shell commands append synchronously through the existing
checked prompt-history transaction under its stable kernel lock. A distinct
record type and audit identity separate them from native user-prompt navigation.
The native 100-command, deduplicated navigation limit is derived from the complete
audit; old commands and repeated submissions remain recorded. Each navigation
operation reads the latest checked snapshot. Persistence and initialization
failures propagate into native submission/render admission without a private
fallback. The unselected native file behavior remains available.

Two further draft controls reproduce acceptance of syntactically valid JSON
containing invalid command data, both on navigation and on direct submission.
Command validation now runs inside the same locked append transaction before
publication. The complete TUI also reproduces the asynchronous loading effect
reporting that error after provider dispatch. A checked read at the start of
`startInteractiveUI` now precedes terminal rendering and inference.

All 22 hook scenarios produce 28 passing bounded native process results. These
include private-home disposal, next-read peer visibility, four simultaneous
writers preserving 40 commands, all 122 audit events behind a 100-command view,
multiline UTF-8 commands, prompt separation, early submission, load/write failure,
invalid commands and eleven unsafe-storage/schema cases. The actual hook body runs through
export-only instrumentation and a finite React dispatcher with dependency-aware
callbacks. That dispatcher supplies hook state and effects; it does not render
the terminal or execute shell commands.

A separate complete CLI control uses a PTY and the TLS-verifying synthetic
provider without adding exports or replacing SDK/native methods. The first TUI
completes inference and executes a finite shell command that creates a witness.
After its whole process group exits, the control removes the private home and
witness. A fresh TUI completes its own inference, then receives shell-mode,
up-arrow and enter keys. Before repair it fails the exact recall assertion;
after repair the recalled command recreates the witness. Seven further complete
TUI controls refuse linked, permissive, malformed, invalid UTF-8 or oversized
command history, including valid JSON with invalid command data, before any
additional provider inference or shell execution,
preserving protected bytes/device/inode/mode/link count/size.

```sh
python3 experiments/issue-3785/native-gemini/apply_shell_history.py /path/to/disposable/gemini-cli --check
python3 experiments/issue-3785/native-gemini/apply_shell_history.py /path/to/disposable/gemini-cli
python3 experiments/issue-3785/native-gemini/probe_shell_history.py /path/to/disposable/gemini-cli --diagnostics /tmp/gemini-shell.log
python3 experiments/issue-3785/probe-gemini-native-cli.py /path/to/disposable/gemini-cli --history --shell-history --diagnostics /tmp/gemini-shell-tui.log
```

The new UI SHA-256 is
`a1f578e876bbdfd04e4140a8a2dfeb6750ab569db2d4d24aadd72e3dd4304422`;
shell helper SHA-256 is
`c1b5b1abca32643ae0674779fe21bcf5713795906b9f6aac0d57a0ce3774e2f0`.
The optional command-validation callback changes the history helper SHA-256 to
`586d39370a4344a1aaa46c81894f2c6239253a91cb84e3871288c2093c328e99`.
The manager and publication pins above remain unchanged.
`verify_shell_application.py` rebuilds all history stages from the pinned
constructor package, verifies applicability checks change no bytes, and compares
the eight resulting manager/CLI/helper files with the tested package. Its fresh
native hook lifetime control also passes. Every native hook worker has a 256 MiB
heap, 16 MiB stack, 25-second deadline and 64 KiB diagnostic cap. Each complete
TUI has a 256 MiB heap, 16 MiB stack, 45-second deadline and 1 MiB output cap;
failed fixtures are retained and every process group is reaped.

Prior-private-state migration, complete interactive failure and crash admission,
Git checkpoints, plans/tracker/task memory, child/subagent lifecycle, alternate
backends and production installation remain open. The checked command journal
retains the existing 32 MiB/100,000-record bound; it does not implement rollover
or unlimited audit retention. Node 24 shell CI 41143418875 passes at
39e2e0d75; its complete log and 658 diagnostic files are preserved locally.
This experiment does not complete the six-tool A1–A12 contract.

## Native tracker generations and validation coordination

The actual exported native `TrackerService`, `Storage` and task schema reproduce
loss of a successfully created, updated and read task after private-home disposal.
A separate complete CLI control enables the native task tracker and drives its
create/update/get/list tools through a TLS-verifying synthetic provider. Its fresh
resumed CLI returns an empty native list before repair, despite recovering the
conversation itself. No native exports or SDK methods are changed in that control.

`apply_tracker.py` uses native project/session paths only as checked selectors.
It records complete task generations in the existing locked prompt audit and
parses them with the actual native task schema. Reads discover current generations;
user prompt navigation stays separate. No private tracker JSON is written. Native
parent/dependency/closure/cycle behavior remains in the original native methods.
Task-ID collisions, stale task saves and invalid generations refuse publication.

The storage draft accepts malformed task data until the tracker tool executes,
after model dispatch. `apply_tracker_admission.py` adds checked tracker startup
before native configuration discovery when the tracker is enabled. Another draft
allows a peer to reopen a dependency after closure validation or change an edge
after cycle validation. `apply_tracker_coordination.py` keeps the actual async
validation reads in an operation context; their observed task revisions must
still match inside the locked append. Independent task creation stays concurrent.
The strict before controls retain both missing-rejection assertions.

Apply these three stages after the shell-history stage, in the order above.
The manager progresses from `439a87bb...` to
`3442803794891386eed95dc0fdf32a41aad77e7212180205e2470d49c4c10413`, then
`b1b2ad9594865d2b60aee3d1b6cbf1a8d2bb2e7d72946124f9a25bc3c2808608`, then
`9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55`.
The final tracker-data helper is
`11e56b631ab984ad8bb7992586a9e6e8b0030fba5e47c1e9b0f2c4fb9497b2c1`;
the transaction helper is
`c504c700a3c11e6d25777e8b495bfba043c729cd67a91fc476465379bb667fd9`.
History, publication and interactive bundle pins remain those above.

```sh
python3 experiments/issue-3785/native-gemini/probe_tracker.py /path/to/disposable/gemini-cli --diagnostics /tmp/gemini-tracker.log
python3 experiments/issue-3785/probe-gemini-native-cli.py /path/to/disposable/gemini-cli --history --tracker-history --diagnostics /tmp/gemini-tracker-cli.log
python3 experiments/issue-3785/native-gemini/verify_shell_application.py /path/to/constructor-package /path/to/tested-package --tracker --output /path/to/new-package
```

The matrix contains 32 scenarios / 40 native process results, including four
writers preserving all forty tasks and audit events, session/project separation,
unnamed and 200-character native sessions, parent/closure/cycle behavior, stale
saves/updates, dependency races, twelve unsafe-audit cases and unselected native
compatibility. Seven complete CLI unsafe-history controls require refusal before
any additional inference and retain protected bytes, identity, mode, link count
and size. The fresh application check rebuilds eight history stages, checks no
mutation during applicability probes and compares all ten manager/CLI/helper files.
Each service process has a 256 MiB heap, 16 MiB stack, 25-second deadline and
64 KiB log bound. CLI deadlines and process-group cleanup are as above.
See `docs/case-studies/issue-3785/evidence/native-gemini-tracker-controls.txt`
for verified results and remaining limits. The Node 24 tracker job passes in
run 41146984829 at 3aff67264d; its 324 diagnostics are preserved locally. The
sibling credential job times out, and the bounded-job partition requires fresh CI.

This is still an opt-in experiment. Existing private tracker migration, direct
third-party writers, complete interactive/crash/power-loss admission, Git
checkpoints, plans/task memory, child/subagent lifecycle, alternate backends,
audit rollover and production installation remain open. The 32 MiB/100,000-event
audit refuses additional writes at its bound. It does not implement the complete
six-tool canonical auth/history contract.

## Native Git checkpoint objects and acknowledged generations

The actual exported native `GitService` and `Storage` first create, read and
restore two healthy snapshots. A fresh service loses them after disposal of its
private home. These controls keep the native Git methods and real Git children;
there is no replacement Git implementation or checkpoint service mock.

Apply `apply_git_history.py`, `apply_git_configuration.py` and
`apply_git_objects.py` after the coordinated tracker stage. Every applicability
check verifies the exact package, manager and prerequisite helper hashes before
writing. The manager becomes
`a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3`.
The helper progresses from
`7be869f6383b20eb21f944d9665268aa169e22ba6696f32337e9a21d52d94dcd` to
`f0573a298e7ebf4ced71dba4b3a90a4d2eac1ddf5be011a525b793530cf39e61`, then
`bad099a4e348abaf08d6f1295af6febc709b2c97a830cd048664a59dbab55e83`.
The configuration helper is
`6da4109b58c0904e490ab3f1e525d1cb42759c4e24572febdea1d67729885451`;
the object-graph helper is
`22bb570da1e211791e3bc6a6eeefe46635fd63ba6df4cc87320978b8de45bd9f`.

Native Git writes loose objects directly to the checked canonical project
`git-checkpoints/objects` directory through an open directory descriptor.
Its executable configuration, hooks, index and derived refs remain private.
Each native operation holds a persistent kernel lock, rereads the canonical head
and reconstructs private refs/index before native work. Checked prompt-journal
appends retain every acknowledged commit generation. Unchanged snapshots and
restores add no duplicate head. Retained services see peer writes on their next
operation; separate private writers serialize their native snapshots.

The initial draft still executes a synthetic clean filter injected into private
Git configuration. The configuration stage checks generated configuration and
private directory identities before Git children execute. A second strict
regression deletes an earlier acknowledged commit: native current-head reads
still succeed before the object stage. Bounded discovery now validates native
loose-object hashes, lengths and typed graph edges reachable from every
acknowledged head before operations. Packs, alternates and unexpected entries
refuse admission. The current-head deletion hypothesis already refuses without
this graph stage; it is not claimed as an additional reproduced defect.

```sh
python3 experiments/issue-3785/native-gemini/probe_git_history.py /path/to/disposable/gemini-cli --diagnostics /tmp/gemini-git.log
python3 experiments/issue-3785/probe-gemini-native-cli.py /path/to/disposable/gemini-cli --history --git-history --diagnostics /tmp/gemini-git-cli.log
python3 experiments/issue-3785/native-gemini/verify_shell_application.py /path/to/constructor-package /path/to/tested-package --git --output /path/to/new-package
```

The matrix contains 21 scenarios / 25 bounded native processes. It covers both
restored file generations, private-home disposal, two writers preserving all six
files and acknowledged heads, peer freshness, project separation, configuration
injection, changed selectors and eleven unsafe-object cases. The complete CLI
initializes its real Git service, completes inference, loses its entire private
home and resumes with the same canonical head and object identities. Seven
complete CLI startup attacks require refusal before any additional inference.
Fresh reconstruction compares all fourteen resulting manager/CLI/helper files.

Each native service process has the same 256 MiB heap, 16 MiB stack, 25-second
execution and 64 KiB diagnostic limits as the tracker probe. Object admission
allows at most 10,000 loose objects, 128 MiB compressed total, 32 MiB per compressed
or inflated object, 200,000 queued graph edges and 1,024 open canonical directory
bindings. The shared audit retains its 32 MiB/100,000-event refusal bounds.
These finite experimental limits are not a production retention policy.

At this Git-only stage, terminal/ACP restorable-tool metadata uses private JSON. The CLI
control establishes Git startup and canonical initial-head continuity; it does
not establish interactive edit/checkpoint/restore continuity. Existing private
Git migration, interrupted object publication, power loss, all backends and
production installation remain unfinished. The adapter stays opt-in and does
not complete A1–A12. See the separate Git evidence file for verified controls;
fresh Node 24 Git CI remains required.

The Git job subsequently passes Node 24 at `40db3a6e3c0acb1dfb19ac9a6f89d36251e0b2d2`
in run 41150101913. The independent history-regression and tracker jobs also pass;
the credential job is still running at this observation. The complete terminal
edit control reveals an additional service-instance gap: the UI constructs its
own `GitService` over startup's initialized repository. Its first snapshot/read
refuses because the original binding admits only a fresh private repository.
`apply_git_services.py` reuses the admitted repository and its configuration seal
across checked service instances, including native repeated initialization.
The resulting Git helper is
`83e535c8d162480a737306aac0f4caf7288d0c790e3473e2ba5dcfaf8b0bbb35`;
the configuration helper is
`3be27b9f5d2aba8b4456397fea5b418cea13a8ed6f5d7a6816191091052272b1`.
Two added native controls cover the same Storage object and a separately
initialized Storage object for the same private repository. A third control
requires a fresh UI service to reject an injected executable Git filter.
This extends the matrix to 24 scenarios / 28 bounded native processes.
It does not persist terminal restore metadata or establish live approval safety.

## Native terminal restore metadata and edit admission

The Git service stage first allows the actual terminal to complete its healthy
checkpoint and approved `write_file` edit. Deleting its entire private home then
leaves `/restore` reporting `File not found`. The strict regression requires both
the original conversation and project snapshot to survive that disposal.

Apply `apply_restorable_history.py` after `apply_git_services.py`, then
`apply_restorable_admission.py`. Both stages check exact pinned source hashes and
unique native contexts before making changes. `--check` makes no changes.
This remains a disposable experiment; no production launcher installs it.

The actual native `processRestorableToolCalls` writer appends its complete JSON
to canonical prompt history with type `restorable-tool` and a reserved session.
Each record retains the generated native filename, Git commit, UI history,
model conversation, tool arguments and prompt identifier. Replacement filenames
derive a current view while preserving every acknowledged generation. The
existing checked publication lock coordinates independent writers. Entries have
a 4 MiB bound within the journal's existing 32 MiB / 100,000-record bounds.

Every read and write validates all metadata generations with the actual native
Zod schema, the native timestamp/basename/tool filename, the reserved session,
and membership of the commit in acknowledged Git history. UI history uses the
same `{type, id}` schema as the actual terminal. Unsafe, missing or changed
storage refuses; there is no fallback to disposable private checkpoint JSON.
The terminal restore command and completion, and the ACP list/read/restore
paths, derive their data from these checked records. Native restore verifies
the acknowledged metadata and restores Git before yielding UI history changes.

A second strict terminal regression damages a metadata history item while
approval is pending. Persistence alone still lets the actual approved edit run.
The admission stage registers the terminal's real history writer, awaits its
complete native snapshot before showing approval and again before execution,
and validates registered metadata before Code Assist dispatch. A failed new
snapshot cannot use an earlier head. A batch serializes checkpoint operations;
normal native unselected behavior remains available. ACP writing and nonterminal
execution paths are separate, unfinished criteria.

Run the actual terminal lifetime and refusal controls with:

```sh
python3 experiments/issue-3785/probe-gemini-native-cli.py "$package" --history --restorable-history --diagnostics /tmp/gemini-restorable.log
python3 experiments/issue-3785/probe-gemini-native-cli.py "$package" --history --restorable-history --restorable-history-attack live-metadata-schema --diagnostics /tmp/gemini-restorable-live.log
python3 experiments/issue-3785/probe-gemini-native-cli.py "$package" --history --restorable-history --restorable-history-attack startup-metadata-schema --diagnostics /tmp/gemini-restorable-startup.log
python3 experiments/issue-3785/native-gemini/probe_restorable_history.py "$package" --diagnostics /tmp/gemini-restorable-api.log
```

Native slash restore automatically replays its saved client-initiated tool.
The terminal test preserves that behavior: an untouched companion file must
return to its pre-edit contents, the original conversation must reappear, and
the stored tool replays without another model request. It deletes the whole
first private home and starts a fresh native terminal, with no native exports or
SDK methods instrumented and a loopback-only TLS provider.

The API suite runs 26 scenarios / 30 native process results, including two
writers preserving all six checkpoints, retained readers seeing peer writes,
replacement generations, project separation, invalid restore ordering, changed
storage/selector and 17 unsafe journal/schema/commit controls. All processes
have finite memory, stack, diagnostic and barrier bounds; failed fixtures remain
available and whole process groups are reaped. `GEMINI_HISTORY_DEBUG=1` enables
content-free refusal locations; it is off by default.

`verify_shell_application.py --restorable` applies fourteen history stages from
the pinned constructor package and compares seventeen native manager, CLI and
helper files with the tested package. The independent `native-restorable-tools`
CI job preserves the two strict negative controls, positive terminal/API checks,
fresh reconstruction and surrounding native checks, within fifteen minutes.
Legacy migration, child/subagent writers, task/plan memory, interrupted and
power-loss durability, actual ACP writing and production integration remain
open. Passing this experiment does not complete the issue.
