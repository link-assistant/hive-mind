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

The assembly job checks both platform manifests, source fingerprints, executable
identities and every license before copying any output. It restores the known
CLI executable modes lost by artifact downloads, then checks the assembled
payload again. A real `npm pack` verifies both complete payloads survive the
published package's file allowlist with identical bytes. Synthetic packaging
unit fixtures never execute and do not establish native CLI behavior.

The installed npm module checks the current machine's complete bundled identity
before copying into a fresh private generation. It publishes only after the
copied bytes verify, preserves collisions and admits existing generations only
when they match this package's manifest. Dependent CI jobs install the actual
npm archive on both native machines and run authentication/model request controls
through that module's installed generation. These compiled-package checks have
not yet run.

Release publication, image/host command activation and removal of the launcher's
credential copy remain required before this adapter can replace the stock
production CLI. This build foundation does not complete those acceptance criteria.
