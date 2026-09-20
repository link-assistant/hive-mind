#!/usr/bin/env bash
# Does the mount-based credential wiring Hive Mind already uses still serve on
# router 1.x, or does 1.x require an explicit `router auth import`?
#
# `--use-router` (issue #2164) mounts ~/.claude at /data/claude and sets
# CLAUDE_CODE_HOME=/data/claude, i.e. it makes the operator's vendor home *be*
# the router's home. Router 1.x added `auth import`, and the question issue #2202
# has to answer is whether that import is now mandatory. The 1.2.0 notes say
# `resolve_home` honours CLAUDE_CODE_HOME as the *destination*, which implies the
# mount is still read directly and an unqualified import would be a self-import.
# This checks that rather than trusting the note.
#
# Synthetic credentials only: the point is whether the router *finds* a
# credential, and a fake one that is found reports as expired rather than absent.
set -u
IMAGE="${1:-ghcr.io/link-assistant/router:1.2.0}"
NAME="hive-mind-router-auth-$$"
HOMEDIR="$(mktemp -d)"
mkdir -p "$HOMEDIR/claude" "$HOMEDIR/codex"
cat > "$HOMEDIR/claude/.credentials.json" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-synthetic-not-a-real-token","refreshToken":"sk-ant-ort01-synthetic-not-a-real-token","expiresAt":1,"scopes":["user:inference"],"subscriptionType":"max"}}
JSON
cat > "$HOMEDIR/codex/auth.json" <<'JSON'
{"OPENAI_API_KEY":null,"tokens":{"id_token":"synthetic.not.a.real.token","access_token":"synthetic-access","refresh_token":"synthetic-refresh","account_id":"synthetic-account"},"last_refresh":"2026-01-01T00:00:00Z"}
JSON

docker rm --force "$NAME" >/dev/null 2>&1 || true
docker run --detach --name "$NAME" \
  --env ROUTER_PORT=443 --env TOKEN_SECRET=probe-secret-not-a-real-key \
  --env DATA_DIR=/data/router --env AUDIT_LOG=/data/router/audit.jsonl \
  --env TLS_SELF_SIGNED=1 --env TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com \
  --env CLAUDE_CODE_HOME=/data/claude --volume "$HOMEDIR/claude:/data/claude" \
  --env CODEX_HOME=/data/codex --volume "$HOMEDIR/codex:/data/codex" \
  "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null 2>&1 || { echo "start failed for $IMAGE"; exit 1; }

for _ in $(seq 1 40); do
  docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 "$NAME" bun -e \
    'Promise.any([fetch("https://127.0.0.1:443/api/health"),fetch("https://127.0.0.1:443/health")]).then(()=>process.exit(0)).catch(()=>process.exit(1))' >/dev/null 2>&1 && break
  sleep 1
done

echo "=== $IMAGE :: startup log (credential discovery lines)"
docker logs "$NAME" 2>&1 | head -40
echo
echo "=== router auth status"
docker exec "$NAME" router auth status 2>&1 | head -40
echo
echo "=== router auth import claude (is the mount a self-import?)"
docker exec "$NAME" router auth import claude 2>&1 | head -20
echo
echo "=== router auth import codex"
docker exec "$NAME" router auth import codex 2>&1 | head -20

docker rm --force "$NAME" >/dev/null 2>&1 || true
rm -rf "$HOMEDIR"
