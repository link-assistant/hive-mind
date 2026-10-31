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

The normal and instant npm release jobs, and branch-package image checks, now
require the same successful native build and assemble its two platform artifacts.
The publish command verifies a fresh actual npm archive after any version commit
or pull, refusing missing platforms and stale recipe/source identities. This
release wiring still needs its first complete successful CI run. Checked command
activation is implemented in both image definitions; actual installed/image
verification and removal of the launcher's credential copy remain required
before this adapter can replace the stock production CLI. This foundation does
not complete those acceptance criteria.

The current recipe reproduces 36 changed native source files. It includes
startup SQLite database/journal file admission and strict app-server handling
when canonical history is selected. The latter prevents upstream default-config
recovery from swallowing a storage-admission error. These changes have focused
filesystem and packaging controls. The actual development CLI passes automatic
strict-policy controls; optimized installed-package verification remains pending.
See the case study's `evidence/codex-sqlite-fallback.txt` and
`evidence/ci-a3ca1a1a8-native.txt` for exact evidence and limits.

Selected native account usage requests capture credentials and their auth
revision together. They revalidate that revision before dispatch and response
publication, refusing retired usage after logout, replacement or malformed
canonical credentials. The actual prior CLI reproduces all three failures;
development, optimized, installed-command and both image checks require the
same real-process controls. The development and optimized x64 executables pass
these controls at f2e845cb3; optimized ARM64, installed-command and image
verification remain pending. This does not establish a filesystem operation
lease or complete default canonical selection. See the case study's
`evidence/codex-native-limits-generation.txt`,
`evidence/ci-f2e845cb3-native-codex.txt` and
`evidence/native-linux-platform-flags.txt`.
