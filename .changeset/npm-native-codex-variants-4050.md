---
'@link-assistant/hive-mind': patch
---

Publish the native Codex executables as per-platform variant versions of this package (`@link-assistant/hive-mind@<version>-native-codex-linux-x64` and `-linux-arm64`, under their own dist-tags) instead of bundling both in the main tarball. npm refused the 2.40.0 and 2.40.1 tarballs (249,847,872 and 249,862,346 bytes) with `E413 Payload Too Large`, so neither version, nor any Docker image, was released (#4050). The main package pins both variants as optional dependency aliases at publication; the runtime admits only the variant whose version matches the main package, and `HIVE_MIND_NATIVE_CODEX_DEBUG=1` (off by default) names the refused phase. Every tarball is now gated below a 157 MiB budget before upload with an annotation naming its largest files, and an E413 fails on the first attempt instead of being retried. Pull request images install the same packed variant at the alias path. See `src/native-codex/PACKAGES.md`.

The publication sanitizer no longer masks a documentation placeholder that closes a Markdown code span after an `Authorization:` header (for example `` `Authorization: token <value>` `` in the 2.40.1 release notes, which lost its closing backtick). Real tokens stay masked; this works around sensitive-data-sanitizer#177 until it is fixed upstream.
