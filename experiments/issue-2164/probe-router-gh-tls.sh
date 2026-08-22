#!/usr/bin/env bash
# Probe: can `gh` (Linux) be told to trust the router's self-signed certificate
# through SSL_CERT_FILE, or is the unix socket the only workable path?
# Upstream README says gh "ignores SSL_CERT_FILE on macOS" — this checks Linux.
set -u
IMAGE="${ROUTER_IMAGE:-ghcr.io/link-assistant/router:0.109.0}"
NAME=rtls
WORK="$(mktemp -d)"
docker rm -f "$NAME" >/dev/null 2>&1
docker volume rm rtls-data >/dev/null 2>&1
docker run -d --name "$NAME" -p 127.0.0.1:8443:8080 \
  -e ROUTER_PORT=8080 -e TOKEN_SECRET=probe-secret -e DATA_DIR=/data/router \
  -e TLS_SELF_SIGNED=1 -e TLS_SELF_SIGNED_DNS=localhost \
  -v rtls-data:/data/router "$IMAGE" serve --host 0.0.0.0 --port 8080 >/dev/null || exit 1
sleep 5
docker logs "$NAME" 2>&1 | grep -iE "tls|listening" | head -5
docker exec "$NAME" link-assistant-router tls ca > "$WORK/ca.pem" 2>"$WORK/ca.err"
echo "ca.pem bytes: $(wc -c < "$WORK/ca.pem")"; head -1 "$WORK/ca.pem"; cat "$WORK/ca.err"
echo "--- curl --cacert ---"
curl -s --cacert "$WORK/ca.pem" https://localhost:8443/health; echo
# Give the router a GitHub credential so /api routes exist (token never printed).
printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}" | docker exec -i "$NAME" link-assistant-router auth gh --token-stdin >/dev/null 2>&1 \
  && echo "auth gh: stored" || echo "auth gh: FAILED"
docker exec "$NAME" link-assistant-router auth gh --status
TOKEN="$(docker exec "$NAME" link-assistant-router tokens issue --label probe --ttl-hours 1 2>/dev/null | grep -o 'la_sk_[A-Za-z0-9._-]*' | head -1)"
[ -n "$TOKEN" ] && echo "token issued: yes" || echo "token issued: NO"
echo "--- gh with SSL_CERT_FILE ---"
GH_CONFIG_DIR="$WORK/gh" SSL_CERT_FILE="$WORK/ca.pem" GH_HOST=localhost:8443 GH_ENTERPRISE_TOKEN="$TOKEN" \
  gh api rate_limit 2>&1 | head -5
echo "--- gh without SSL_CERT_FILE (control) ---"
GH_CONFIG_DIR="$WORK/gh" GH_HOST=localhost:8443 GH_ENTERPRISE_TOKEN="$TOKEN" \
  gh api rate_limit 2>&1 | head -3
echo "workdir: $WORK"
