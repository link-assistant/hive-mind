## Summary

`examples/javascript-first/Dockerfile:2` builds on `FROM rust:1.96.0-slim@sha256:c37af730be4fd8104cbf9aedbd6ab259e51ca2d5437817a0f8680edf66ac6c28`, but the current Rust release is 1.100.0 (2026-11-12). Nothing reports the gap: the repository has no `.github/dependabot.yml` (so no `docker` ecosystem), and no workflow compares base-image pins with the registry. The pin gets older silently, and its toolchain drifts from the `toolchain: stable` the workflows test with.

Found while auditing [link-assistant/hive-mind#4055](https://github.com/link-assistant/hive-mind/issues/4055). There, a freshness check warned `library/rust 1.99 -> 1.100.0 (minor)` for its Dockerfiles, and the pins were updated.

## Reproduction

```sh
grep -n '^FROM' examples/javascript-first/Dockerfile
# 2:FROM rust:1.96.0-slim@sha256:c37af730...
ls .github/dependabot.yml   # No such file or directory
gh api repos/rust-lang/rust/releases/latest -q .tag_name   # 1.100.0
```

## Workaround

Update the tag and digest by hand: `docker buildx imagetools inspect rust:1.100.0-slim`.

## Suggested fix

Add `.github/dependabot.yml` with a `docker` entry for `/examples/javascript-first`, plus `github-actions` and `cargo`, each with a cooldown like the python and cpp templates have. Dependabot updates tag and digest together. Also add a test that every `FROM` with a registry image is covered by a `docker` entry, so the next Dockerfile is not missed. hive-mind's version is in `tests/dependency-freshness-2264.test.mjs` (link-assistant/hive-mind#4056). It requires a Dependabot ecosystem exactly when the repository has something for it to update; configuring one with nothing to update produces a "groups where no dependencies match" warning on every run.
