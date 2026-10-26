# Native Qwen authentication experiments

This patches a disposable copy of the real Qwen 0.26.1 package, whose token
manager bundle has SHA-256
`76d55ad14363fa0ceb0ce4ef0f24c85096a93c1b93a25e311273838b746b95b8`.
The locked experiment overrides `sharp` to 0.35.5 for GHSA-wq5f-xc86-pv6w;
Qwen remains 0.26.1 and its inspected bundle bytes are unchanged.
The version and exact bytes must match before any file is changed. Production
images and launchers do not install or select this experiment.

The actual manager's forced read checks only whether `mtime` increased.
It retains G0 after an atomic G1 replacement with the same timestamp. Its
missing-file handler resets the timestamp while retaining both manager and
client credentials, so logout still returns G1. Ordinary reads add a five-second
polling interval and can reuse either stale state without checking disk.

The repair reads disk for each caller, including concurrent clients. It clears
both caches and raises a constant error when storage is unavailable or unsafe.
The bounded Linux reader requires an existing owned private directory and an
owned private regular credential file with one link. It rejects redirected
parents and opens the file relative to an inspected directory descriptor.
The one MiB read limit, nonblocking/no-follow open and before/after file identity
checks prevent unbounded reads, FIFO hangs and accepting a changed generation
during inspection. Parser excerpts and credential bytes never enter errors.

Reproduce and verify with a disposable package installation:

```sh
npm ci --prefix experiments/issue-3785/native-qwen/stock-cli --ignore-scripts --omit=optional --no-audit --no-fund
export QWEN_PROBE_MODULE="$PWD/experiments/issue-3785/native-qwen/stock-cli/node_modules/@qwen-code/qwen-code/chunks/chunk-KZQDCUQR.js"
node experiments/issue-3785/probe-qwen-native-reads.mjs --expect-native-gaps
# The strict regression must fail here for same-timestamp replacement.
node experiments/issue-3785/probe-qwen-native-reads.mjs
python3 experiments/issue-3785/native-qwen/apply_reads.py experiments/issue-3785/native-qwen/stock-cli/node_modules/@qwen-code/qwen-code --check
python3 experiments/issue-3785/native-qwen/apply_reads.py experiments/issue-3785/native-qwen/stock-cli/node_modules/@qwen-code/qwen-code
node experiments/issue-3785/probe-qwen-native-reads.mjs
```

The probe uses the real native manager methods with a mocked OAuth client that
never contacts a network. It passes only synthetic credentials through IPC,
reports generation tags and counts exchanges. Each worker has a 128 MiB V8 heap,
1.5 GiB data-address bound, 16 MiB stack, 64 KiB output bound and a finite
15-second experiment deadline. Every child is reaped before temporary cleanup.
The larger virtual-address bound permits V8 reservations; a 512 MiB bound
prevented the worker from starting and was not treated as defect evidence.

All 14 native read controls pass locally. The dedicated GitHub Actions workflow
requires the exact failing regression, healthy reload controls and the repaired
forced/ordinary replacement, recreation, logout, malformed, permission, link,
directory, oversized and parent-directory cases. It separately retains the
native lock-ownership defect and its healthy control.

The read repair does not complete canonical Qwen authentication. The independent
auth/config root contract, writer coordination and actual CLI model-request
refusal require the next experiment and full integration evidence below.

## Native writer coordination

After the read repair, the actual `QwenOAuth2Client.getAccessToken()` still
swallows the manager's storage refusal and returns an undefined token. The
`--native-client --expect-undefined-token` control reproduces that behavior;
the strict native-client regression fails before the coordination patch.

`apply_coordination.py` accepts only the exact read-patched bundle and pinned
shared lock implementation. It selects `QWEN_AUTH_HOME` for OAuth credentials
independently of `QWEN_HOME` configuration. An empty/relative selector or a
second private OAuth credential file is refused. Without the selector the
native credential location is retained, with the experimental strict storage
and coordination behavior. No production launcher sets the selector yet.

The patch routes the actual manager, direct OAuth refresh, device-flow/cache
publication and logout through one stable descriptor-owned Linux `flock`.
Async-local transaction ownership lets the native invalid-grant path clear
credentials inside its refresh transaction. Every refresh rereads disk after
locking, retains the current refresh token if the response omits a replacement,
and compares the predecessor file version before durable atomic publication.
Both memory and client caches update only after manager publication succeeds;
the native client now propagates refusal instead of returning an empty token.
Exit handlers never unlink a lock, and a legacy native lock prevents admission
without guessing its age or deleting another owner's evidence.

A private durable intent precedes an exchange. If an owner dies or the network
outcome is unknown before a new generation is published, peers refuse to
consume G0 again. A fresh successful login can publish G2 and clear the intent.
If a different generation was already durably published before owner death,
the next transaction synchronizes it and completes intent cleanup. Unsafe or
malformed intent evidence is preserved and refused; automated recovery of
corrupt markers remains unimplemented.

The inspected installed package references OAuth credential storage in its
central manager/cache/clear module. The server device-flow adapter delegates to
that cache function. Other filename matches are storage declarations or
unrelated MCP/Google/remote SDK refreshers. This audit does not establish every
alternative native credential backend or provider selection path.

```sh
# Run after the read-repair commands above.
node experiments/issue-3785/probe-qwen-native-reads.mjs --native-client --expect-undefined-token
# Strict --native-client must fail before the coordination repair.
python3 experiments/issue-3785/native-qwen/apply_coordination.py experiments/issue-3785/native-qwen/stock-cli/node_modules/@qwen-code/qwen-code --check
python3 experiments/issue-3785/native-qwen/apply_coordination.py experiments/issue-3785/native-qwen/stock-cli/node_modules/@qwen-code/qwen-code
node experiments/issue-3785/probe-qwen-lock-ownership.mjs --expect-coordinated --private-configs
node experiments/issue-3785/probe-qwen-native-reads.mjs --native-client
node experiments/issue-3785/probe-qwen-native-writers.mjs
```

All 14 manager and 14 actual-client read controls pass locally after coordination.
The ownership probe observes the real peer waiting in the kernel before release
and verifies no second exchange or lock replacement after a non-owner exits.
It also passes with three separate configuration roots and no private credential
copies. Eleven actual native OAuth writer controls pass: two refreshers,
refresh/login, refresh/logout, invalid grant, forced owner death, unknown network
outcome, direct native refresh, a competing raw publication, unsafe lock, live
legacy lock and conflicting private authority. Every worker is bounded and
reaped, uses synthetic state and captures no native diagnostic bytes. The writer
probe replaces `fetch` with a local response stub and counts exchanges, so it
does not establish model-request admission through the real CLI.

Native read and coordination CI passes in run [40396374276](https://github.com/link-assistant/hive-mind/actions/runs/40396374276)
at c1bfa9c6c; downloaded diagnostics confirm all 11 native writer cases.
The newer actual CLI/factory controls below still require a fresh CI run.
Full CLI lifecycle and cross-container evidence,
alternative credential backends, shared conversation history, production
integration, migration of existing homes and CLI-upgrade/release/deployment
coverage remain unfinished. Do not enable the adapter based on these controls
alone.

## Actual CLI provider admission

The real pinned CLI rejects `--auth-type qwen-oauth` unconditionally, explaining
that its OAuth free tier was discontinued on 2026-04-15. The native validator in
`chunks/chunk-M4DATMYW.js` contains that refusal. The actual bounded CLI control
verifies exit 1 and zero model requests, and this behavior remains intact.
Consequently the native OAuth-method controls above do not prove a usable CLI
OAuth login flow or support for the current Coding Plan/API-key backends.

A separate actual CLI control selects `QWEN_AUTH_HOME` with synthetic G0 OAuth
credentials, then supplies an independent G2 OpenAI-compatible API key. Before
repair it sends a loopback model request authenticated as G2 and succeeds. The
strict zero-request regression fails. `apply_request_auth.py` hash-checks the
exact native provider-factory bundle before adding an explicit refusal for
unsupported authorities. It checks creation, lazy loading and each later use
of a retained provider handle. Other native constructors outside this inspected
factory are not established.

The actual CLI regression passes after repair: exit 1, a constant error and zero
model requests. Without the canonical selector, the same native CLI completes
one request using the explicit synthetic API key. The actual factory separately
refuses five alternative provider modes, six OAuth authority overrides, and all
15 content/stream/embedding calls through five retained provider handles after
canonical selection changes. The probe uses private disposable homes, no
operator environment, a finite one-turn input, 256 MiB child heap, 2 GiB data
address bound, 16 MiB stack, 128 KiB output bound and 30-second deadline.
Every process and loopback server is closed before cleanup.

```sh
# After read/coordination repair, before provider admission repair:
node experiments/issue-3785/probe-qwen-native-cli.mjs --expect-provider-bypass
# Strict default invocation must fail before repair.
python3 experiments/issue-3785/native-qwen/apply_request_auth.py experiments/issue-3785/native-qwen/stock-cli/node_modules/@qwen-code/qwen-code --check
python3 experiments/issue-3785/native-qwen/apply_request_auth.py experiments/issue-3785/native-qwen/stock-cli/node_modules/@qwen-code/qwen-code
node experiments/issue-3785/probe-qwen-native-cli.mjs
node experiments/issue-3785/probe-qwen-native-cli.mjs --factory-controls
node experiments/issue-3785/probe-qwen-native-cli.mjs --without-selector
node experiments/issue-3785/probe-qwen-native-cli.mjs --oauth-sunset
```

This is a refusal guard for unsupported authority, not canonical storage for
the current API-key/Coding Plan backends. That implementation and its native
writer/lifecycle verification remain required before production admission.
