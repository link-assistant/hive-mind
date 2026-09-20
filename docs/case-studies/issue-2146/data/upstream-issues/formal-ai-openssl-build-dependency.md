`cargo install formal-ai --locked` fails on a stock Rust image since 0.333.0: the dependency tree now requires a system OpenSSL

## Summary

Every release from `0.333.0` onwards fails to install on an image that has a Rust toolchain and nothing else, because the dependency tree pulls `native-tls` → `openssl-sys`, and `openssl-sys` needs `pkg-config` plus the OpenSSL development headers at build time. `0.317.0` installs on the same image. Nothing in the crate's own `Cargo.toml` changed — the requirement arrived transitively — so the break is invisible from the release notes and only shows up as a red Docker build downstream.

## Reproduction

```bash
docker run --rm rust:1.96-slim-bookworm \
  cargo install formal-ai --version 0.337.0 --locked
```

```
warning: openssl-sys@0.9.117: Could not find directory of OpenSSL installation
error: failed to run custom build command for `openssl-sys v0.9.117`

  Could not find openssl via pkg-config:
  Could not run `PKG_CONFIG_ALLOW_SYSTEM_CFLAGS=1 pkg-config --libs --cflags openssl`
  The pkg-config command could not be found.
  Try `apt install pkg-config` ...
  Make sure you also have the development packages of openssl installed.
  For example, `libssl-dev` on Ubuntu or `openssl-devel` on Fedora.

error: failed to compile `formal-ai v0.337.0`
```

The same command with `--version 0.317.0` succeeds.

## Where the OpenSSL requirement comes from

Reading the published `Cargo.lock` of each release (`curl -sL https://static.crates.io/crates/formal-ai/formal-ai-<v>.crate | tar xz`):

| Release | `openssl-sys` in `Cargo.lock` |
| ------- | ----------------------------- |
| 0.317.0 | absent                        |
| 0.333.2 | present                       |
| 0.336.0 | present                       |
| 0.337.0 | present                       |

Two independent paths introduce it, both through crates added in the 0.333.0 line:

```
formal-ai
├── web-search 0.3.1  ── reqwest 0.13  (rustls only — fine)
└── web-capture 0.3.34
    ├── reqwest 0.12.28   default-features = true  → default-tls → native-tls → openssl-sys
    └── browser-commander ── fantoccini 0.21.5  default-features = true  → native-tls → openssl
```

`web-capture` and `browser-commander` both take their dependency with default features on, and in both cases the default feature is the OpenSSL-backed TLS stack:

- `web-capture 0.3.34` and the current `0.3.36`: `reqwest = { version = "0.12", features = ["cookies", "gzip"] }` — `default-features` left at `true`, so `default-tls` = `native-tls`.
- `browser-commander 0.10.9`: `fantoccini = "0.21"` with default features; `fantoccini`'s `default = ["native-tls"]`, and `native-tls = ["hyper-tls", "openssl"]`.

`web-search 0.5.0` is already clean — its `reqwest 0.13` resolves to `rustls` — so this is not an "all HTTP needs OpenSSL" situation. Two crates, one line each.

## Impact

- Any consumer that builds the binary in a container has to guess the new system requirement. In Hive Mind this is a four-Dockerfile builder stage; the failure surfaced only in the Docker CI job, after the whole unit suite was green.
- Statically linking is the only way to keep the `rust:slim-bookworm` builder → Ubuntu 24.04 runtime copy safe; a dynamically linked `libssl.so.3` would tie the produced binary to the runtime image's OpenSSL packaging.
- `rustls` is already in the tree (`web-search`, `hyper-rustls`), so OpenSSL currently buys nothing but a build-time system dependency and a second TLS implementation in the same binary.

## Downstream workaround (in use today)

```dockerfile
FROM rust:1.96-slim-bookworm AS formal-ai-builder
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*
ENV OPENSSL_STATIC=1
RUN cargo install formal-ai --version "${FORMAL_AI_VERSION}" --locked
```

Verified: `openssl-sys 0.9.117` compiles, and `ldd` on the resulting binary reports no `libssl`/`libcrypto`, so the copy into the runtime image stays self-contained.

## Proposed fix

1. `link-assistant/web-capture` — take `reqwest` without default features:

   ```toml
   reqwest = { version = "0.12", default-features = false, features = ["cookies", "gzip", "rustls-tls", "charset", "http2"] }
   ```

2. `link-foundation/browser-commander` — take `fantoccini` without default features:

   ```toml
   fantoccini = { version = "0.21", default-features = false, features = ["rustls-tls"] }
   ```

3. `link-assistant/formal-ai` — after both land, bump to the fixed versions and re-cut a release; `openssl*` should disappear from `Cargo.lock` entirely.

If OpenSSL has to stay for a reason not visible from the manifests, the fallback is to expose a `vendored-openssl` feature that forwards to `openssl/vendored` and to state the `pkg-config` + `libssl-dev` build requirement in the README, so consumers stop discovering it from a build script backtrace.

## Acceptance tests

- A CI job that runs `cargo install --path . --locked` inside plain `rust:slim-bookworm` (no `apt-get install`) and fails the build if it does not succeed — this is the check that would have caught the regression on the release that introduced it.
- `cargo tree -i openssl-sys` returns nothing on the fixed release.
- `ldd` on the release binary lists no `libssl.so`/`libcrypto.so`.

## Environment

- `rust:1.96-slim-bookworm` (`cargo 1.96`), amd64, Docker 29.6.0.
- Observed in `link-assistant/hive-mind` CI job `docker-pr-check`, run 31378794502, and reproduced locally.
