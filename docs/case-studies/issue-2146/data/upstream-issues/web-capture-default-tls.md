`reqwest` is taken with default features, so every consumer inherits an OpenSSL build dependency

## Summary

`web-capture` depends on `reqwest 0.12` with `default-features` left at `true`. `reqwest 0.12`'s default set includes `default-tls`, which is `native-tls`, which is `openssl-sys`. Anything that depends on `web-capture` therefore stops building on a machine that has a Rust toolchain but no `pkg-config` and no OpenSSL headers — even when it never makes an HTTPS request itself.

## Where

`Cargo.toml`, both in the version currently in the wild (`0.3.34`) and in the newest release (`0.3.36`):

```toml
reqwest = { version = "0.12", features = ["cookies", "gzip"] }
```

`cargo tree -i openssl-sys` from a consumer:

```
openssl-sys 0.9.117
└── openssl 0.10.81
    └── native-tls 0.2.x
        └── reqwest 0.12.28
            └── web-capture 0.3.34
```

## Reproduction

```bash
docker run --rm rust:1.96-slim-bookworm sh -c \
  'cargo new /tmp/p >/dev/null && cd /tmp/p && cargo add web-capture && cargo build'
```

```
error: failed to run custom build command for `openssl-sys v0.9.117`
  Could not find openssl via pkg-config: The pkg-config command could not be found.
  Make sure you also have the development packages of openssl installed.
```

The same build succeeds once `pkg-config` and `libssl-dev` are installed — the point is that neither is documented as a requirement, and neither is needed for what the crate actually does.

## Impact

Downstream this reached `link-assistant/formal-ai` (0.333.0+ depends on `web-capture`) and from there `link-assistant/hive-mind`, whose four Docker builder stages started failing on `cargo install formal-ai --locked`. The failure appears in a build-script backtrace three levels below anything the consumer wrote.

`rustls` is already present in the same trees via `reqwest 0.13`/`hyper-rustls`, so today's default costs a system dependency and a duplicate TLS stack and buys nothing.

## Proposed fix

```toml
reqwest = { version = "0.12", default-features = false, features = ["cookies", "gzip", "rustls-tls", "charset", "http2"] }
```

`charset` and `http2` are part of `reqwest 0.12`'s default set; keep whichever of them the crate relies on and drop the rest. If some consumer genuinely needs the system TLS stack, expose it as an opt-in feature (`native-tls = ["reqwest/native-tls"]`) instead of as the default.

Note that this alone does not make the tree OpenSSL-free: `web-capture → browser-commander → fantoccini` takes `fantoccini` with default features, whose `default = ["native-tls"]`. That half is filed separately on `link-foundation/browser-commander`.

## Acceptance tests

- CI job that builds the crate inside plain `rust:slim-bookworm` with no `apt-get install` step.
- `cargo tree -i openssl-sys` is empty for a default-feature build.
