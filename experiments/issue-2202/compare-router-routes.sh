#!/usr/bin/env bash
# Compare the route surface of the pinned router (0.119.0) against 1.2.0.
#
# `--use-router` (issue #2164) sends four different clients at the router:
# Claude Code, Codex, `gh` and `git`. Router 1.0.0 replaced every legacy route
# with `/api/health`, `/api/management/*` and `/api/services/*` and removed the
# aliases (upstream #391), so this prints, side by side, which shapes each
# version answers — the evidence the pin bump in issue #2202 is decided on.
#
# 401 means "route exists, authenticate"; 404 means "no such route".
set -u
PATHS='
/health
/api/health
/v1/models
/v1/messages
/v1/responses
/api/services/anthropic/v1/models
/api/services/openai/v1/models
/api/services/codex/v1/models
/api/services/qwen/v1/models
/api/services/gemini/v1beta/models
/api/v3/rate_limit
/api/graphql
/git/link-assistant/hive-mind/info/refs
/api/services/github/api/v3/rate_limit
/api/services/github/api/graphql
/api/services/github/git/link-assistant/hive-mind/info/refs
/api/management/tokens
'

probe_one() {
  local image="$1" name="hive-mind-router-cmp-$$-$2"
  local ghdir; ghdir="$(mktemp -d)"
  cat > "$ghdir/hosts.yml" <<'YML'
github.com:
    oauth_token: gho_probeprobeprobeprobeprobeprobeprobe
    user: probe
    git_protocol: https
YML
  docker rm --force "$name" >/dev/null 2>&1 || true
  docker run --detach --name "$name" \
    --env ROUTER_PORT=443 --env TOKEN_SECRET=probe-secret-not-a-real-key \
    --env DATA_DIR=/data/router --env AUDIT_LOG=/data/router/audit.jsonl \
    --env TLS_SELF_SIGNED=1 --env TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com \
    --env GH_CONFIG_DIR=/data/gh --volume "$ghdir:/data/gh:ro" \
    "$image" serve --host 0.0.0.0 --port 443 >/dev/null 2>&1 || { echo "start failed for $image"; return 1; }
  for _ in $(seq 1 40); do
    docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 "$name" bun -e \
      'Promise.any([fetch("https://127.0.0.1:443/api/health"),fetch("https://127.0.0.1:443/health")]).then(()=>process.exit(0)).catch(()=>process.exit(1))' >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 --env "PROBE_PATHS=$PATHS" "$name" bun -e '
    for (const p of (process.env.PROBE_PATHS || "").split("\n").filter(Boolean)) {
      try { const r = await fetch("https://127.0.0.1:443" + p); console.log(p + "\t" + r.status); }
      catch (e) { console.log(p + "\tERR"); }
    }
  ' 2>/dev/null
  docker rm --force "$name" >/dev/null 2>&1 || true
  rm -rf "$ghdir"
}

OLD="${1:-ghcr.io/link-assistant/router:0.119.0}"
NEW="${2:-ghcr.io/link-assistant/router:1.2.0}"
probe_one "$OLD" old > /tmp/router-old.tsv
probe_one "$NEW" new > /tmp/router-new.tsv

printf '%-56s %-10s %-10s\n' 'path' "${OLD##*:}" "${NEW##*:}"
printf '%-56s %-10s %-10s\n' '------------------------------------------------------' '--------' '--------'
while IFS=$'\t' read -r p old; do
  new=$(awk -F'\t' -v k="$p" '$1==k{print $2}' /tmp/router-new.tsv)
  printf '%-56s %-10s %-10s\n' "$p" "$old" "${new:--}"
done < /tmp/router-old.tsv
