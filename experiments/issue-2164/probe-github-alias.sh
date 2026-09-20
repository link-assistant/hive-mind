#!/usr/bin/env bash
# Issue #2164 — can a routed task keep using `gh` unchanged?
#
# `GH_HOST=<router>` only routes the `--repo owner/repo` form: `gh issue view
# <url>` reads the host out of the URL and goes straight to api.github.com,
# which is exactly the form Hive Mind's own prompts tell the agent to use.
#
# This probes the alternative: give the router container the Docker network
# alias `api.github.com`, serve HTTPS on 443 with a self-signed certificate that
# carries that name, and hand the task the router token as GH_TOKEN. Every gh
# call then lands on the router whatever form it was written in.
#
# Redacts `la_sk_…` from all output; safe to commit the log.
set -u

IMAGE=${IMAGE:-ghcr.io/link-assistant/router:0.109.0}
NET=probe-2164-net
ROUTER=probe-2164-router
CLIENT_IMAGE=${CLIENT_IMAGE:-debian:trixie-slim}
WORK=$(mktemp -d)
redact() { sed -E 's/la_sk_[A-Za-z0-9._-]*/la_sk_REDACTED/g'; }

cleanup() {
  docker rm -f "$ROUTER" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== 1. router on 443, TLS for the alias names =="
docker network create "$NET" >/dev/null
docker run -d --name "$ROUTER" \
  -e ROUTER_PORT=443 \
  -e TOKEN_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  -e DATA_DIR=/data/router \
  -e TLS_SELF_SIGNED=1 \
  -e TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com \
  -e GH_CONFIG_DIR=/root/.config/gh \
  -v "$HOME/.config/gh:/root/.config/gh:ro" \
  "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null || exit 1
# The internal network is attached afterwards so the default bridge, and with it
# the route to api.github.com the router itself needs, survives.
docker network connect --alias link-assistant-router --alias api.github.com "$NET" "$ROUTER"
sleep 5
docker exec "$ROUTER" router auth gh --status 2>&1 | head -3

echo
echo "== 2. certificate and token =="
docker exec "$ROUTER" router tls ca > "$WORK/ca.pem" || exit 1
openssl x509 -in "$WORK/ca.pem" -noout -text | grep -A1 "Subject Alternative Name"
cat /etc/ssl/certs/ca-certificates.crt "$WORK/ca.pem" > "$WORK/bundle.pem"
TOKEN=$(docker exec "$ROUTER" router tokens issue --label probe --ttl-hours 1 --max-requests 200)
echo "token issued: ${TOKEN:0:6}… ($(printf %s "$TOKEN" | wc -c) chars)"

gh_probe() {
  local label=$1; shift
  echo "--- $label"
  docker run --rm --network "$NET" \
    -v /usr/bin/gh:/usr/bin/gh:ro \
    -v "$WORK/bundle.pem:/etc/hive-mind-router-ca.pem:ro" \
    -e GH_TOKEN="$TOKEN" \
    -e SSL_CERT_FILE=/etc/hive-mind-router-ca.pem \
    -e GH_CONFIG_DIR=/tmp/gh-empty \
    "$CLIENT_IMAGE" "$@" 2>&1 | redact | head -5
}

echo
echo "== 3. gh from a task container, no GH_HOST, no gh credential =="
gh_probe "URL form (what the prompts tell the agent to use)" gh issue view https://github.com/link-assistant/hive-mind/issues/2164 --json title
gh_probe "repo form" gh issue view 2164 --repo link-assistant/hive-mind --json title
gh_probe "pr view by URL" gh pr view https://github.com/link-assistant/hive-mind/pull/2165 --json title,state
gh_probe "gh api path form" gh api repos/link-assistant/hive-mind --jq .full_name
gh_probe "gh api graphql" gh api graphql -f query='query{viewer{login}}'
gh_probe "destructive: DELETE a label" gh api -X DELETE repos/link-assistant/hive-mind/labels/does-not-exist-2164

echo
echo "== 4. control: same container without the CA =="
docker run --rm --network "$NET" -v /usr/bin/gh:/usr/bin/gh:ro -e GH_TOKEN="$TOKEN" -e GH_CONFIG_DIR=/tmp/gh-empty \
  "$CLIENT_IMAGE" gh api repos/link-assistant/hive-mind --jq .full_name 2>&1 | redact | head -3

echo
echo "== 5. router request log (per token) =="
docker exec "$ROUTER" sh -c 'find /data/router/requests -name requests.jsonl | head -2 | xargs -r tail -n 3' 2>&1 | cut -c1-240 | redact
