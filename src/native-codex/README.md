# Pinned native Codex build

`recipe.json` identifies the upstream commit, all adapter inputs, the compiler,
release profile, supported Linux machines and upstream license notices.
`scripts/build-native-codex.py` applies those checked inputs to a fresh checkout,
records every changed source file, builds only the actual CLI, and packages the
executable with its source inventory and provenance. It refuses changed inputs,
changed prepared source, the wrong machine type, oversized executables and
unexpected CLI versions. Compilation uses one Cargo job with debug information
disabled and a pinned optimized profile.

The release-build workflow compiles on native x64 and arm64 Ubuntu runners, then
exercises actual status, reauthentication, logout and model request controls
against each packaged binary. Its artifacts are build outputs with finite CI
retention; they are not a production runtime download service.

Release publication, npm artifact inclusion, image/host installation, installed
runtime admission and removal of the launcher's credential copy remain required
before this adapter can replace the stock production CLI. This build foundation
does not complete those acceptance criteria.
