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
`463cf8af6e9a06f2a1ff7ae2a484fcfa5d8d53f77c604f3e51344e71f3b1ed61`.
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
