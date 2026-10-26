# Native Qwen read experiment

This patches a disposable copy of the real Qwen 0.26.1 package, whose token
manager bundle has SHA-256
`76d55ad14363fa0ceb0ce4ef0f24c85096a93c1b93a25e311273838b746b95b8`.
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
auth/config root contract, stable OS lock, all refresh/login/logout writers,
publication durability, invalid-grant handling and actual CLI model-request
refusal remain unfinished. In particular, the native client can swallow a
manager error and return an undefined access token, and an exiting non-owner
still unlinks another native manager's refresh lock. Full CLI and cross-container
evidence are required before enabling a production adapter. Private-storage
admission also needs migration and compatibility coverage for existing homes.
