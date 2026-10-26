# Native Codex auth-directory adapter experiment

This source experiment preserves native Codex commands while separating their
file credentials from configuration. It is **not installed by the images or
production launcher**. Canonical production projection, native refresh locking,
cached-read invalidation, history and all-writer lifecycle coverage remain open.

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
Environment/header credentials and custom-provider routes still need production
authority admission. This experiment does not establish that they cannot bypass
the selected file store.

The file adapter anchors operations to an open directory descriptor; bounds
reads to 1 MiB; rejects linked, nonregular, shared-permission and multi-link
files; commits with a private temporary file, rename and fsync; and implements
native deletion/recreation. A stable descriptor lock primitive is included and
tested, **but the native refresh/read/write entrypoints do not use it yet**.
Atomic file replacement alone does not serialize refresh-token exchanges.

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
three explicit negative controls must establish stale cached replacement,
stale cached logout, and duplicate predecessor consumption after both processes
have loaded the same generation. Startup/build failure cannot satisfy a control.
These controls have not yet run; their presence is not acceptance evidence.
It is an experimental build check; it does not certify or replace the required
six-tool release/deployment lifecycle matrix. Await its actual result before
claiming native-command acceptance. Local full CLI compilation must respect the
container memory budget; use one compiler with debug data disabled and use an
adequately provisioned runner if a compiler is killed.
