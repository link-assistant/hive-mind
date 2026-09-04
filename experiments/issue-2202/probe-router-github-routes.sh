#!/usr/bin/env bash
# Second router 1.2.0 probe: do the GitHub proxy routes appear once the sidecar
# actually holds a GitHub credential?
#
# The first probe (probe-router-1.2.0.sh) saw 404 on
# `/api/services/github/api/v3/rate_limit` while every AI catalogue route
# answered 401 — 401 means "route exists, authenticate"; 404 means "no such
# route". This distinguishes "the GitHub routes were removed" from "the GitHub
# routes are registered only when a GitHub credential is present", which decides
# whether `--use-router`'s GitHub mediation survives the 1.x pin.
set -u
IMAGE="${1:-ghcr.io/link-assistant/router:1.2.0}"
NAME="hive-mind-router-ghprobe-$$"
GHDIR="$(mktemp -d)"

cleanup() { docker rm --force "$NAME" >/dev/null 2>&1 || true; rm -rf "$GHDIR"; }
trap cleanup EXIT

# A syntactically valid but non-functional gh config: the point is route
# registration, not a successful upstream call, so no real token is used.
cat > "$GHDIR/hosts.yml" <<'YML'
github.com:
    oauth_token: gho_probeprobeprobeprobeprobeprobeprobe
    user: probe
    git_protocol: https
YML

docker run --detach --name "$NAME" \
  --env ROUTER_PORT=443 \
  --env TOKEN_SECRET=probe-secret-not-a-real-key \
  --env DATA_DIR=/data/router \
  --env AUDIT_LOG=/data/router/audit.jsonl \
  --env TLS_SELF_SIGNED=1 \
  --env TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com \
  --env GH_CONFIG_DIR=/data/gh \
  --volume "$GHDIR:/data/gh:ro" \
  "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null 2>&1 \
  || { echo "docker run failed"; exit 1; }

for _ in $(seq 1 30); do
  docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 "$NAME" \
    bun -e 'fetch("https://127.0.0.1:443/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1 && break
  sleep 1
done

echo "=== auth status ==="
docker exec "$NAME" router auth status 2>&1 | head -20

echo
echo "=== route probes with a GitHub credential mounted ==="
docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 "$NAME" bun -e '
const paths = [
  "/api/services/github/api/v3/rate_limit",
  "/api/services/github/api/graphql",
  "/api/services/github/git/link-assistant/hive-mind/info/refs",
  "/repos/link-assistant/hive-mind",
  "/api/v3/rate_limit",
  "/api/graphql",
  "/graphql",
  "/link-assistant/hive-mind/info/refs",
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
