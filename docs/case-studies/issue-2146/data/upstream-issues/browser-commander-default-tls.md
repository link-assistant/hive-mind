`fantoccini` is taken with default features, which forces OpenSSL on every consumer

## Summary

`browser-commander` depends on `fantoccini` with `default-features` left at `true`. `fantoccini`'s manifest declares:

```toml
default = ["native-tls"]
native-tls = ["hyper-tls", "openssl"]
rustls-tls = ["hyper-rustls"]
```

So every consumer of `browser-commander` inherits `openssl` → `openssl-sys`, and stops building on a machine that has a Rust toolchain but no `pkg-config` and no OpenSSL development headers.

## Where

`Cargo.toml` of `0.10.9` (and of `0.9.x`, which is what is resolved through `web-capture` today):

```toml
fantoccini = "0.21"
```

`cargo tree -i openssl` from a consumer:

```
openssl 0.10.81
└── fantoccini 0.21.5
    └── browser-commander 0.9.x
        └── web-capture 0.3.34
            └── formal-ai 0.337.0
```

## Reproduction

```bash
docker run --rm rust:1.96-slim-bookworm sh -c \
  'cargo new /tmp/p >/dev/null && cd /tmp/p && cargo add browser-commander && cargo build'
```

```
error: failed to run custom build command for `openssl-sys v0.9.117`
  Could not find openssl via pkg-config: The pkg-config command could not be found.
```

## Impact

This is one of the two paths that made `cargo install formal-ai --locked` fail on a stock Rust image from 0.333.0 onwards, which in turn broke the Docker builder stages in `link-assistant/hive-mind`. Fixing only the `reqwest` side in `web-capture` is not enough — this path keeps `openssl-sys` in the tree on its own.

## Proposed fix

```toml
fantoccini = { version = "0.21", default-features = false, features = ["rustls-tls"] }
```

`chromiumoxide` is already taken as `{ version = "0.7", features = ["tokio-runtime"] }` and does not pull a TLS stack, so this one line is the whole change. If a consumer needs the system TLS stack, re-expose it as an opt-in feature (`native-tls = ["fantoccini/native-tls"]`) rather than as the default.

## Acceptance tests

- CI job that builds the crate inside plain `rust:slim-bookworm` with no `apt-get install` step.
- `cargo tree -i openssl-sys` is empty for a default-feature build.
- The WebDriver integration tests still pass against an HTTPS endpoint under `rustls`.
