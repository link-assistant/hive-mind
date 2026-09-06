#!/usr/bin/env bash
# The per-task token lease, run against each image given, with the exact argv
# `src/router-sidecar.lib.mjs` uses.
#
# Why this exists: router 0.125.4 lists "deny generic or administrative tokens
# access to consumer subscriptions unless an exact operator-approved
# client/provider override exists (#389)" and "bind each managed launch to a
# signed client kind and subscriber principal". Hive Mind's token is minted by
# `router tokens issue` with no client kind, so whether it is still accepted at
# the protocol boundary is a question the changelog raises and only a
# measurement answers. Route *existence* is what compare-router-routes.sh
# covers; this covers token *acceptance*.
#
# Usage: probe-router-token-lease.sh [image …]   (default: 0.119.0 and 0.125.4)
set -u
IMAGES=("$@")
if [ ${#IMAGES[@]} -eq 0 ]; then
  IMAGES=(ghcr.io/link-assistant/router:0.119.0 ghcr.io/link-assistant/router:0.125.4)
fi

# Mirrors ROUTER_TOKEN_TTL_HOURS / ROUTER_TOKEN_MAX_REQUESTS and the label shape
# `hive-mind:${sessionId}` from issueRouterTaskToken.
SESSION="probe-session-$$"

probe_one() {
  local image="$1"
  local name="hive-mind-router-lease-$$-$(echo "$image" | tr -c 'a-zA-Z0-9' '-')"
  local homedir; homedir="$(mktemp -d)"
  mkdir -p "$homedir/gh"
  cat > "$homedir/gh/hosts.yml" <<'YML'
github.com:
    oauth_token: gho_syntheticnotarealtokenaaaaaaaaaaaaaaaaaa
    user: probe
    git_protocol: https
YML

  docker rm --force "$name" >/dev/null 2>&1 || true
  docker run --detach --name "$name" \
    --env ROUTER_PORT=443 --env TOKEN_SECRET=probe-secret-not-a-real-key \
    --env DATA_DIR=/data/router --env AUDIT_LOG=/data/router/audit.jsonl \
    --env TLS_SELF_SIGNED=1 --env TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com \
    --env GH_CONFIG_DIR=/data/gh --volume "$homedir/gh:/data/gh" \
    "$image" serve --host 0.0.0.0 --port 443 >/dev/null 2>&1 || { echo "  start failed"; rm -rf "$homedir"; return 1; }

  local ready=no
  for _ in $(seq 1 40); do
    if docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 "$name" bun -e \
      'Promise.any([fetch("https://127.0.0.1:443/health"),fetch("https://127.0.0.1:443/api/health")]).then(()=>process.exit(0)).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=yes; break; fi
    sleep 1
  done
  echo "  health: $ready"

  echo "  --- tokens issue (issueRouterTaskToken argv)"
  local out token
  out="$(docker exec "$name" router tokens issue --label "hive-mind:${SESSION}" --ttl-hours 12 --max-requests 2000 2>&1)"
  token="$(printf '%s' "$out" | grep -oE 'la_sk_[A-Za-z0-9._-]+' | head -1)"
  if [ -n "$token" ]; then echo "  minted: yes (${#token} chars)"; else echo "  minted: NO — output: $(printf '%s' "$out" | tail -3)"; fi

  echo "  --- tokens issue --github-repo (repo-scoped lease)"
  local scoped
  scoped="$(docker exec "$name" router tokens issue --label "hive-mind:${SESSION}-scoped" --ttl-hours 12 --github-repo link-assistant/hive-mind 2>&1 | grep -oE 'la_sk_[A-Za-z0-9._-]+' | head -1)"
  [ -n "$scoped" ] && echo "  scoped mint: yes" || echo "  scoped mint: NO"

  if [ -n "$token" ]; then
    echo "  --- the minted token at the protocol boundary"
    docker exec --env NODE_TLS_REJECT_UNAUTHORIZED=0 --env "PROBE_TOKEN=$token" "$name" bun -e '
      const paths = ["/v1/models", "/v1/messages", "/api/v3/rate_limit", "/git/link-assistant/hive-mind/info/refs?service=git-upload-pack"];
      for (const p of paths) {
        try {
          const r = await fetch("https://127.0.0.1:443" + p, { headers: { authorization: "Bearer " + process.env.PROBE_TOKEN } });
          console.log("  " + p.split("?")[0] + " -> " + r.status + " :: " + (await r.text()).replace(/\s+/g, " ").slice(0, 160));
        } catch (e) { console.log("  " + p + " -> ERROR " + e.message); }
      }
    ' 2>&1 | grep -v '^$'

    echo "  --- tokens list / revoke"
    docker exec "$name" router tokens list 2>&1 | grep -c "hive-mind:${SESSION}" | sed 's/^/  leases listed: /'
    # decodeRouterTokenId: the id is the `sub` claim of the base64url payload.
    local id
    id="$(printf '%s' "$token" | sed 's/^la_sk_//' | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | grep -oE '"sub":"[^"]+"' | cut -d'"' -f4)"
    echo "  decoded token id: ${id:-<none>}"
    [ -n "$id" ] && docker exec "$name" router tokens revoke "$id" >/dev/null 2>&1 && echo "  revoke: ok" || echo "  revoke: failed"
  fi

  echo "  --- startup log (last 6 lines)"
  docker logs "$name" 2>&1 | tail -6 | sed 's/^/    /'
  docker rm --force "$name" >/dev/null 2>&1 || true
  rm -rf "$homedir"
}

for image in "${IMAGES[@]}"; do
  echo "=============================================================="
  echo "== $image"
  echo "=============================================================="
  docker pull "$image" >/dev/null 2>&1 || echo "  (pull failed; using local copy if any)"
  probe_one "$image"
  echo
done
