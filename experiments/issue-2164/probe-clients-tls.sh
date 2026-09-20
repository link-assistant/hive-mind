#!/usr/bin/env bash
# Probe: do the agent CLIs Hive Mind launches accept a router that serves HTTPS
# with a self-signed certificate, when the CA is supplied through the standard
# environment variables? A TLS failure and an application error look different,
# so no vendor subscription is needed to tell them apart.
set -u
WORK="${1:?usage: probe-clients-tls.sh <dir-with-ca.pem>}"
CA="$WORK/ca.pem"
TOK="$(cat /tmp/rtls-tok)"
BASE=https://localhost:8443
run() { # run <label> <timeout> <command...>
  local label="$1" t="$2"; shift 2
  echo "=== $label"
  timeout "$t" "$@" 2>&1 | tail -6 | sed 's/la_sk_[A-Za-z0-9._-]*/<token>/g'
  echo "--- exit: $?"
}
export ANTHROPIC_BASE_URL="$BASE" ANTHROPIC_AUTH_TOKEN="$TOK" ANTHROPIC_API_KEY="$TOK"
export OPENAI_BASE_URL="$BASE/v1" OPENAI_API_KEY="$TOK"

run "claude WITHOUT ca"            25 env -u NODE_EXTRA_CA_CERTS claude -p hi --model claude-sonnet-4-5
run "claude WITH NODE_EXTRA_CA_CERTS" 25 env NODE_EXTRA_CA_CERTS="$CA" claude -p hi --model claude-sonnet-4-5
run "codex WITHOUT ca"             25 env -u SSL_CERT_FILE codex exec --skip-git-repo-check hi
run "codex WITH SSL_CERT_FILE"     25 env SSL_CERT_FILE="$CA" codex exec --skip-git-repo-check hi
