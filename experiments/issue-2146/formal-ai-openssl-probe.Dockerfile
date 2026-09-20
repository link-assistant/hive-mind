# Reproduction + fix probe for the Formal AI builder stage break (issue #2146).
#
#   docker build -f experiments/issue-2146/formal-ai-openssl-probe.Dockerfile \
#     --target broken --build-arg FORMAL_AI_VERSION=0.337.0 .   # fails
#   docker build -f experiments/issue-2146/formal-ai-openssl-probe.Dockerfile \
#     --target fixed  --build-arg FORMAL_AI_VERSION=0.337.0 .   # succeeds
#
# formal-ai >= 0.333.0 pulls web-capture/web-search, which enable reqwest's
# default `native-tls` feature, so `openssl-sys` now has to find a system
# OpenSSL. rust:slim-bookworm carries neither pkg-config nor the OpenSSL
# headers, so `cargo install formal-ai --locked` fails in the builder stage.
ARG FORMAL_AI_VERSION=0.337.0

FROM rust:1.96-slim-bookworm AS broken
ARG FORMAL_AI_VERSION
RUN cargo install formal-ai --version "${FORMAL_AI_VERSION}" --locked

FROM rust:1.96-slim-bookworm AS fixed
ARG FORMAL_AI_VERSION
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*
ENV OPENSSL_STATIC=1
RUN cargo install formal-ai --version "${FORMAL_AI_VERSION}" --locked
RUN ldd /usr/local/cargo/bin/formal-ai && formal-ai --version
