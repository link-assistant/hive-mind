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

The inspected native cache-publication control is still distinguished from the
interactive flows. Account metadata, other provider constructors/retained handles,
full CLI inference, full conversation storage and production installation remain
open. One control keeps an actual native OAuth client model request pending while
a second process reads G1, proving the credential lock is released during that
request. Its model transport is synthetic. These tests do not establish live
provider replay/grace behavior or the complete six-tool contract.
