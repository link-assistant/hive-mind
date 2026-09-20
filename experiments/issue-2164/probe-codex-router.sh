#!/usr/bin/env bash
# Issue #2164 — can codex be pointed at the router?
#
# `OPENAI_BASE_URL` alone does not move codex 0.147: probe-clients-tls.sh caught
# it still talking to api.openai.com. Codex takes its endpoint from a provider
# entry in `CODEX_HOME/config.toml`, so this probes a generated config that names
# the router, reads the task token from the environment, and speaks the
# `responses` wire API the router serves at /v1/responses.
#
# The task image ships no codex, so the host's bun-installed one is bind-mounted;
# hive-mind installs the CLI into the container the same way at run time.
set -u

IMAGE=${IMAGE:-ghcr.io/link-assistant/router:0.109.0}
NET=probe-2164-codex-net
ROUTER=probe-2164-codex-router
CLIENT=probe-2164-codex-client
CLIENT_IMAGE=${CLIENT_IMAGE:-konard/box:2.3.5}
WORK=$(mktemp -d)
redact() { sed -E 's/la_sk_[A-Za-z0-9._-]*/la_sk_REDACTED/g'; }

cleanup() {
  docker rm -f "$ROUTER" "$CLIENT" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$ROUTER" \
  -e ROUTER_PORT=443 -e TOKEN_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  -e DATA_DIR=/data/router -e TLS_SELF_SIGNED=1 -e TLS_SELF_SIGNED_DNS=link-assistant-router \
  -e CODEX_HOME=/data/codex -v "$HOME/.codex:/data/codex" \
  "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null || exit 1
docker network connect --alias link-assistant-router "$NET" "$ROUTER"
sleep 5
docker exec "$ROUTER" router tls ca > "$WORK/ca.pem" || exit 1
TOKEN=$(docker exec "$ROUTER" router tokens issue --label probe-codex --ttl-hours 1 --max-requests 50)

mkdir -p "$WORK/codex"
cat > "$WORK/codex/config.toml" <<TOML
model_provider = "hive-mind-router"

[model_providers.hive-mind-router]
name = "Hive Mind Router"
base_url = "https://link-assistant-router/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
TOML

echo "== generated CODEX_HOME/config.toml =="
cat "$WORK/codex/config.toml"

echo
echo "== codex exec through the router =="
docker run --rm --network "$NET" \
  -v "$WORK/codex:/home/box/.codex" \
  -v "$HOME/.bun:/home/box/.bun:ro" \
  -v "$WORK/ca.pem:/etc/hive-mind-router-ca.pem:ro" \
  -e HOME=/home/box \
  -e CODEX_HOME=/home/box/.codex \
  -e OPENAI_API_KEY="$TOKEN" \
  -e SSL_CERT_FILE=/etc/hive-mind-router-ca.pem \
  -e NODE_EXTRA_CA_CERTS=/etc/hive-mind-router-ca.pem \
  "$CLIENT_IMAGE" codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
  'Reply with exactly: ROUTED' 2>&1 | redact | tail -12

echo
echo "== router request log (which upstream did it use?) =="
docker exec "$ROUTER" sh -c 'find /data/router/requests -name requests.jsonl | head -2 | xargs -r grep -h "\"phase\":\"upstream_request\"\|\"path\"" | tail -3' 2>&1 | cut -c1-200 | redact
