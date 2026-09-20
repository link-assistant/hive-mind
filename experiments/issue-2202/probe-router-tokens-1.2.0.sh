#!/usr/bin/env bash
# Does `docker exec <router> tokens issue …` — how Hive Mind mints a per-task
# token (issue #2164, `issueRouterTaskToken`) — still work on router 1.x?
#
# 1.2.0 prints a bootstrap admin token at startup and says "admin endpoints are
# closed", which raises the question of whether the in-container CLI now needs
# that token to mint. This checks the exact call Hive Mind makes, plus the
# revoke it pairs with on teardown.
set -u
IMAGE="${1:-ghcr.io/link-assistant/router:1.2.0}"
NAME="hive-mind-router-tokens-$$"
HOMEDIR="$(mktemp -d)"
mkdir -p "$HOMEDIR/claude"
cat > "$HOMEDIR/claude/.credentials.json" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-synthetic-not-a-real-token","refreshToken":"sk-ant-ort01-synthetic-not-a-real-token","expiresAt":1,"scopes":["user:inference"],"subscriptionType":"max"}}
JSON

docker rm --force "$NAME" >/dev/null 2>&1 || true
docker run --detach --name "$NAME" \
  --env ROUTER_PORT=443 --env TOKEN_SECRET=probe-secret-not-a-real-key \
  --env DATA_DIR=/data/router --env AUDIT_LOG=/data/router/audit.jsonl \
  --env TLS_SELF_SIGNED=1 --env TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com \
  --env CLAUDE_CODE_HOME=/data/claude --volume "$HOMEDIR/claude:/data/claude" \
  "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null 2>&1 || { echo "start failed for $IMAGE"; exit 1; }
for _ in $(seq 1 40); do
  docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 "$NAME" bun -e \
    'Promise.any([fetch("https://127.0.0.1:443/api/health"),fetch("https://127.0.0.1:443/health")]).then(()=>process.exit(0)).catch(()=>process.exit(1))' >/dev/null 2>&1 && break
  sleep 1
done

echo "=== tokens issue (the argv Hive Mind uses today)"
docker exec "$NAME" router tokens issue --label hive-mind-probe --max-tokens 100000 --rate-limit-per-minute 60 2>&1 | tail -12
echo
echo "=== tokens list"
docker exec "$NAME" router tokens list 2>&1 | tail -12
echo
echo "=== tokens issue --github-repo (repo-scoped, as --use-router does)"
docker exec "$NAME" router tokens issue --label hive-mind-probe-scoped --github-repo link-assistant/hive-mind 2>&1 | tail -8
echo
echo "=== a minted token against the catalogue route"
TOKEN="$(docker exec "$NAME" router tokens issue --label hive-mind-probe-cat 2>&1 | grep -oE 'la_sk_[A-Za-z0-9._-]+' | head -1)"
if [ -n "${TOKEN:-}" ]; then
  docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 --env "PROBE_TOKEN=$TOKEN" "$NAME" bun -e '
    for (const p of ["/api/services/anthropic/v1/models", "/api/services/codex/v1/models"]) {
      const r = await fetch("https://127.0.0.1:443" + p, { headers: { authorization: "Bearer " + process.env.PROBE_TOKEN } });
      console.log(p + " -> " + r.status + " " + (await r.text()).slice(0, 400));
    }
  ' 2>&1 | tail -6
else
  echo "no token parsed from the issue output"
fi

docker rm --force "$NAME" >/dev/null 2>&1 || true
rm -rf "$HOMEDIR"
