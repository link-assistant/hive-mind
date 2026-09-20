#!/usr/bin/env bash
# Issue #2164 — a routed Claude Code task, end to end.
#
# The task container holds no vendor credential: ~/.claude is mounted into the
# router and nowhere else. Claude Code is pointed at the router with
# ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN and trusts the router's self-signed CA
# through NODE_EXTRA_CA_CERTS, which is the variable Node (and therefore Claude
# Code) reads. The subscription's real model ids are asked for first, because the
# router advertises exactly what the subscription does and resolves no aliases.
#
# The task image ships no claude, so the host's install is bind-mounted by path;
# hive-mind installs the CLI into the container itself at run time.
set -u

IMAGE=${IMAGE:-ghcr.io/link-assistant/router:0.109.0}
NET=probe-2164-claude-net
ROUTER=probe-2164-claude-router
CLIENT_IMAGE=${CLIENT_IMAGE:-konard/box:2.3.5}
WORK=$(mktemp -d)
redact() { sed -E 's/la_sk_[A-Za-z0-9._-]*/la_sk_REDACTED/g'; }

cleanup() {
  docker rm -f "$ROUTER" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$ROUTER" \
  -e ROUTER_PORT=443 -e TOKEN_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  -e DATA_DIR=/data/router -e TLS_SELF_SIGNED=1 -e TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com \
  -e CLAUDE_CODE_HOME=/data/claude -v "$HOME/.claude:/data/claude" \
  "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null || exit 1
docker network connect --alias link-assistant-router "$NET" "$ROUTER"
sleep 5
docker exec "$ROUTER" router tls ca > "$WORK/ca.pem" || exit 1
TOKEN=$(docker exec "$ROUTER" router tokens issue --label probe-claude --ttl-hours 1 --max-requests 100)

echo "== models this subscription advertises =="
MODELS=$(docker run --rm --network "$NET" -v "$WORK/ca.pem:/ca.pem:ro" "$CLIENT_IMAGE" \
  curl -s --cacert /ca.pem -H "Authorization: Bearer $TOKEN" https://link-assistant-router/v1/models)
printf '%s' "$MODELS" | tr ',' '\n' | grep '"id"' | head -8
MODEL=${MODEL:-$(printf '%s' "$MODELS" | tr ',' '\n' | grep -o '"claude-sonnet-[a-z0-9-]*"' | head -1 | tr -d '"')}
echo "using model: ${MODEL:-<none found>}"

echo
echo "== claude -p through the router (no ~/.claude in the task) =="
docker run --rm --network "$NET" \
  -v "$HOME/.bun:/home/box/.bun:ro" -v "$HOME/.local:/home/box/.local:ro" \
  -v "$WORK/ca.pem:/etc/hive-mind-router-ca.pem:ro" \
  -e HOME=/home/box \
  -e ANTHROPIC_BASE_URL=https://link-assistant-router \
  -e ANTHROPIC_AUTH_TOKEN="$TOKEN" \
  -e ANTHROPIC_API_KEY="$TOKEN" \
  -e NODE_EXTRA_CA_CERTS=/etc/hive-mind-router-ca.pem \
  "$CLIENT_IMAGE" /home/box/.local/bin/claude -p 'Reply with exactly: ROUTED' --model "$MODEL" 2>&1 | redact | tail -5

echo
echo "== per-token request log =="
docker exec "$ROUTER" sh -c 'find /data/router -name "requests.jsonl" | head -2' 
docker exec "$ROUTER" sh -c 'find /data/router -name "requests.jsonl" | head -1 | xargs -r grep -h "\"phase\":\"client_request\"" | tail -1' | cut -c1-200 | redact
