#!/usr/bin/env bash
# Issue #2164 — transparent `gh` routing without a DNS self-loop.
#
# The first attempt (probe-github-alias.sh) gave the router container the Docker
# network alias `api.github.com`. Every gh form did reach the router, but every
# proxied call then failed with 502: Docker's embedded DNS answers the alias for
# *every* container on the network including the alias holder, so the router
# resolved api.github.com to itself.
#
# This probes the fix: leave the alias off, and instead write
# `<router-ip> api.github.com` into the *task* container's /etc/hosts after it is
# attached to the router network. The task resolves api.github.com to the router;
# the router still resolves it through public DNS to real GitHub.
#
# /etc/hosts is written with `docker exec --user 0` because start-command's Docker
# backend forwards only --privileged/-e/-v/--mount/--network/--network-alias, so
# there is no --add-host to pass through; the start gate holds the task command
# until the host has finished wiring it up.
#
# Redacts `la_sk_…` from all output; safe to commit the log.
set -u

IMAGE=${IMAGE:-ghcr.io/link-assistant/router:0.109.0}
NET=probe-2164-net
ROUTER=probe-2164-router
CLIENT=probe-2164-client
CLIENT_IMAGE=${CLIENT_IMAGE:-debian:trixie-slim}
WORK=$(mktemp -d)
redact() { sed -E 's/la_sk_[A-Za-z0-9._-]*/la_sk_REDACTED/g'; }

cleanup() {
  docker rm -f "$ROUTER" "$CLIENT" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== 1. router on 443, TLS for link-assistant-router AND api.github.com =="
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
docker network connect --alias link-assistant-router "$NET" "$ROUTER"
sleep 5
docker exec "$ROUTER" router auth gh --status 2>&1 | head -3
ROUTER_IP=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$ROUTER")
echo "router ip on $NET: $ROUTER_IP"

echo
echo "== 2. certificate and token =="
docker exec "$ROUTER" router tls ca > "$WORK/ca.pem" || exit 1
openssl x509 -in "$WORK/ca.pem" -noout -text | grep -A1 "Subject Alternative Name"
TOKEN=$(docker exec "$ROUTER" router tokens issue --label probe --ttl-hours 1 --max-requests 200)
echo "token issued: $(printf %s "$TOKEN" | wc -c) chars"

echo
echo "== 3. task container: attach, then write /etc/hosts, then assemble the CA bundle =="
docker run -d --name "$CLIENT" --network "$NET" \
  -v /usr/bin/gh:/usr/bin/gh:ro \
  -v /usr/bin/git:/usr/bin/git:ro \
  -v "$WORK/ca.pem:/home/hive-mind-router-ca.pem:ro" \
  -e GH_TOKEN="$TOKEN" \
  -e SSL_CERT_FILE=/tmp/router-bundle.pem \
  -e GH_CONFIG_DIR=/tmp/gh-empty \
  "$CLIENT_IMAGE" sleep 600 >/dev/null || exit 1
docker exec --user 0 "$CLIENT" sh -c "printf '%s api.github.com\n' '$ROUTER_IP' >> /etc/hosts"
docker exec --user 0 "$CLIENT" sh -c 'cat /etc/ssl/certs/ca-certificates.crt /home/hive-mind-router-ca.pem > /tmp/router-bundle.pem'
docker exec "$CLIENT" sh -c 'getent hosts api.github.com'

gh_probe() {
  local label=$1; shift
  echo "--- $label"
  docker exec "$CLIENT" "$@" 2>&1 | redact | head -5
}

echo
echo "== 4. gh from the task container, no GH_HOST, no gh credential =="
gh_probe "URL form (what the prompts tell the agent to use)" gh issue view https://github.com/link-assistant/hive-mind/issues/2164 --json title
gh_probe "repo form" gh issue view 2164 --repo link-assistant/hive-mind --json title
gh_probe "pr view by URL" gh pr view https://github.com/link-assistant/hive-mind/pull/2165 --json title,state
gh_probe "gh api path form" gh api repos/link-assistant/hive-mind --jq .full_name
gh_probe "gh api graphql" gh api graphql -f query='query{viewer{login}}'
gh_probe "destructive: DELETE a label" gh api -X DELETE repos/link-assistant/hive-mind/labels/does-not-exist-2164

echo
echo "== 5. control: the router still reaches real GitHub (no self-loop) =="
docker exec "$ROUTER" sh -c 'getent hosts api.github.com' 2>&1 | head -2

echo
echo "== 6. control: same container, CA removed =="
docker exec -e SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt "$CLIENT" gh api repos/link-assistant/hive-mind --jq .full_name 2>&1 | redact | head -3

echo
echo "== 7. router request log (per token) =="
docker exec "$ROUTER" sh -c 'find /data/router/requests -name requests.jsonl | head -2 | xargs -r tail -n 3' 2>&1 | cut -c1-240 | redact
