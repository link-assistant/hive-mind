#!/usr/bin/env bash
# Issue #2164 R11 — can `--model formal-ai` be served through the same router?
#
# Formal AI already runs as an on-demand sidecar (issue #2146) serving an
# OpenAI-compatible endpoint on an internal network. Routing it "through the
# router" means the router has to reach that endpoint and pick it for a request
# that names the `formal-ai` model. This probes exactly that, with a stub in
# place of the real Formal AI image so the answer is about the router:
#
#   1. UPSTREAM_PROVIDER=auto (the default) with the provider stored — does a
#      request for the advertised model reach it?
#   2. UPSTREAM_PROVIDER=openai-compatible pinned at the same provider — does it?
#
# The difference between the two answers decides whether one shared sidecar can
# serve both Claude and Formal AI tasks.
set -u

IMAGE=${IMAGE:-ghcr.io/link-assistant/router:0.109.0}
CLIENT_IMAGE=${CLIENT_IMAGE:-konard/box:2.3.5}
NET=probe-2164-fa-net
ROUTER=probe-2164-fa-router
STUB=probe-2164-fa-stub
WORK=$(mktemp -d)
SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
redact() { sed -E 's/la_sk_[A-Za-z0-9._-]*/la_sk_REDACTED/g'; }

cleanup() {
  docker rm -f "$ROUTER" "$STUB" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

docker network create "$NET" >/dev/null

# A stand-in for the Formal AI sidecar: an OpenAI-compatible endpoint that
# advertises exactly one model and says who answered.
cat > "$WORK/stub.mjs" <<'JS'
const body = obj => new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json' } });
Bun.serve({
  port: 8080,
  hostname: '0.0.0.0',
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.endsWith('/models')) return body({ object: 'list', data: [{ id: 'formal-ai', object: 'model', owned_by: 'formal-ai' }] });
    if (pathname.endsWith('/chat/completions') || pathname.endsWith('/responses'))
      return body({ id: 'stub-1', object: 'chat.completion', model: 'formal-ai', choices: [{ index: 0, message: { role: 'assistant', content: 'FORMAL-AI-STUB' }, finish_reason: 'stop' }] });
    if (pathname === '/health') return body({ status: 'ok' });
    return new Response('not found', { status: 404 });
  },
});
JS
docker run -d --name "$STUB" --network "$NET" --network-alias link-assistant-formal-ai \
  -v "$WORK/stub.mjs:/tmp/stub.mjs:ro" "$CLIENT_IMAGE" bun /tmp/stub.mjs >/dev/null || exit 1
sleep 3

start_router() {
  docker rm -f "$ROUTER" >/dev/null 2>&1
  docker run -d --name "$ROUTER" \
    -e ROUTER_PORT=443 -e TOKEN_SECRET="$SECRET" -e DATA_DIR=/data/router \
    -e TLS_SELF_SIGNED=1 -e TLS_SELF_SIGNED_DNS=link-assistant-router \
    -e AUDIT_LOG=/data/router/audit.jsonl \
    -v "$WORK/router-data:/data/router" \
    "$@" "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null || exit 1
  docker network connect --alias link-assistant-router "$NET" "$ROUTER"
  sleep 5
}

ask() { # $1 = token
  docker run --rm --network "$NET" \
    -v "$WORK/ca.pem:/tmp/ca.pem:ro" "$CLIENT_IMAGE" \
    curl -sS --cacert /tmp/ca.pem -m 30 -o /dev/stdout -w '\n[http %{http_code}]\n' \
    -H "Authorization: Bearer $1" -H 'content-type: application/json' \
    -d '{"model":"formal-ai","messages":[{"role":"user","content":"hi"}],"max_tokens":16}' \
    https://link-assistant-router/v1/chat/completions 2>&1 | cut -c1-400 | redact
}

echo "== 1. router with UPSTREAM_PROVIDER=auto (default) =="
start_router
docker exec "$ROUTER" router tls ca > "$WORK/ca.pem"
TOKEN=$(docker exec "$ROUTER" router tokens issue --label probe-formal-ai --ttl-hours 1 --max-requests 50)

echo "-- providers add --"
docker exec "$ROUTER" router providers add --name hive-mind-formal-ai \
  --base-url http://link-assistant-formal-ai:8080/v1 --model formal-ai --models formal-ai --api-key stub 2>&1 | redact
docker exec "$ROUTER" router providers list 2>&1 | redact

echo "-- /v1/models as the task sees it --"
docker run --rm --network "$NET" -v "$WORK/ca.pem:/tmp/ca.pem:ro" "$CLIENT_IMAGE" \
  curl -sS --cacert /tmp/ca.pem -m 20 -H "Authorization: Bearer $TOKEN" https://link-assistant-router/v1/models 2>&1 | cut -c1-300 | redact

echo "-- chat completion for model 'formal-ai' --"
ask "$TOKEN"

echo
echo "== 2. same router pinned to the stored provider =="
start_router -e UPSTREAM_PROVIDER=openai-compatible -e OPENAI_COMPATIBLE_PROVIDER_NAME=hive-mind-formal-ai
docker exec "$ROUTER" router tls ca > "$WORK/ca.pem"
TOKEN2=$(docker exec "$ROUTER" router tokens issue --label probe-formal-ai-pinned --ttl-hours 1 --max-requests 50)
docker exec "$ROUTER" router providers list 2>&1 | redact
ask "$TOKEN2"

echo
echo "== 3. is the exchange in the router's own logs? =="
docker exec "$ROUTER" sh -c 'ls -la /data/router; ls /data/router/requests 2>/dev/null | head -3; tail -2 /data/router/audit.jsonl 2>/dev/null || echo "(no audit.jsonl)"' 2>&1 | cut -c1-300 | redact
