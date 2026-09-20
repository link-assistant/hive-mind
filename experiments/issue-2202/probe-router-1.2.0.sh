#!/usr/bin/env bash
# Probe router 1.2.0 for the facts issue #2202's R3/R4 depend on.
#
# Answers, without a subscription and without spending a token:
#   1. which health path answers, and whether the legacy one is gone;
#   2. whether the legacy /v1/* aliases are really removed;
#   3. whether a GitHub-native path (`/repos/...`) still routes, which is what
#      Hive Mind's transparent api.github.com interception depends on;
#   4. what `serve`, `auth` and `tokens` accept in 1.2.0.
#
# Usage: experiments/issue-2202/probe-router-1.2.0.sh [image]
set -u
IMAGE="${1:-ghcr.io/link-assistant/router:1.2.0}"
NAME="hive-mind-router-probe-$$"

cleanup() { docker rm --force "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "=== image: $IMAGE ==="
docker run --rm "$IMAGE" --version 2>&1 | head -3

echo
echo "=== router serve --help ==="
docker run --rm "$IMAGE" serve --help 2>&1 | head -80

echo
echo "=== router auth --help ==="
docker run --rm "$IMAGE" auth --help 2>&1 | head -40

echo
echo "=== router auth claude --help ==="
docker run --rm "$IMAGE" auth claude --help 2>&1 | head -40

echo
echo "=== router auth codex --help ==="
docker run --rm "$IMAGE" auth codex --help 2>&1 | head -40

echo
echo "=== router tokens issue --help ==="
docker run --rm "$IMAGE" tokens issue --help 2>&1 | head -40

echo
echo "=== starting sidecar the way Hive Mind starts it ==="
docker run --detach --name "$NAME" \
  --env ROUTER_PORT=443 \
  --env TOKEN_SECRET=probe-secret-not-a-real-key \
  --env DATA_DIR=/data/router \
  --env AUDIT_LOG=/data/router/audit.jsonl \
  --env TLS_SELF_SIGNED=1 \
  --env TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com \
  "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null 2>&1 \
  || { echo "docker run failed"; exit 1; }

for _ in $(seq 1 30); do
  docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 "$NAME" \
    bun -e 'fetch("https://127.0.0.1:443/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1 && break
  sleep 1
done

echo
echo "=== route probes (status codes) ==="
docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 "$NAME" bun -e '
const paths = [
  "/api/health",
  "/health",
  "/v1/models",
  "/v1/messages",
  "/api/services/anthropic/v1/models",
  "/api/services/openai/v1/models",
  "/api/services/codex/v1/models",
  "/api/services/qwen/v1/models",
  "/api/services/gemini/v1beta/models",
  "/api/services/github/api/v3/rate_limit",
  "/repos/link-assistant/hive-mind",
  "/api/v3/repos/link-assistant/hive-mind",
  "/api/management/tokens",
];
for (const p of paths) {
  try {
    const r = await fetch("https://127.0.0.1:443" + p);
    console.log(String(r.status).padEnd(4), p);
  } catch (e) {
    console.log("ERR ", p, String(e).slice(0, 60));
  }
}
' 2>&1

echo
echo "=== container log ==="
docker logs "$NAME" 2>&1 | tail -30
