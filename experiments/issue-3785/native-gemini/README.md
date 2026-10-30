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
