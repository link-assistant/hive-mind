#!/usr/bin/env bash
# Issue #2164 R13 / upstream evidence — what does git actually send on a forced push?
#
# Router 0.109.0 refuses a non-fast-forward only when the receive-pack body
# announces `force-ref-updates` or `push-force` (src/git_proxy.rs
# `body_requests_force`). This captures the capability list a real `git push
# --force` sends, so the claim can be checked rather than assumed.
#
# The push is guaranteed not to reach GitHub: the task token is scoped to a
# different repository with `--github-repo`, so the router refuses it on scope
# regardless of the ref policy. The trace is taken client-side either way.
set -u

IMAGE=${IMAGE:-ghcr.io/link-assistant/router:0.109.0}
NET=probe-2164-cap-net
ROUTER=probe-2164-cap-router
CLIENT=probe-2164-cap-client
CLIENT_IMAGE=${CLIENT_IMAGE:-konard/box:2.3.5}
BRANCH=${BRANCH:-issue-2164-90464ce530a2}
WORK=$(mktemp -d)
redact() { sed -E 's/la_sk_[A-Za-z0-9._-]*/la_sk_REDACTED/g'; }

cleanup() {
  docker rm -f "$ROUTER" "$CLIENT" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$ROUTER" \
  -e ROUTER_PORT=443 -e TOKEN_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  -e DATA_DIR=/data/router -e TLS_SELF_SIGNED=1 -e TLS_SELF_SIGNED_DNS=link-assistant-router \
  -e GH_CONFIG_DIR=/root/.config/gh -v "$HOME/.config/gh:/root/.config/gh:ro" \
  "$IMAGE" serve --host 0.0.0.0 --port 443 >/dev/null || exit 1
docker network connect --alias link-assistant-router "$NET" "$ROUTER"
sleep 5
docker exec "$ROUTER" router tls ca > "$WORK/ca.pem" || exit 1
# Two tokens: an unrestricted one to clone with, and one scoped to a different
# repository to push with, so the router refuses the push on scope and the
# branch cannot move whatever the ref policy decides.
TOKEN=$(docker exec "$ROUTER" router tokens issue --label probe-cap-read --ttl-hours 1 --max-requests 50)
SCOPED=$(docker exec "$ROUTER" router tokens issue --label probe-cap-push --ttl-hours 1 --max-requests 50 --github-repo link-assistant/router)

docker run -d --name "$CLIENT" --network "$NET" \
  -v "$WORK/ca.pem:/etc/hive-mind-router-ca.pem:ro" -e GIT_TERMINAL_PROMPT=0 -e HOME=/home/box \
  "$CLIENT_IMAGE" sleep 600 >/dev/null || exit 1
docker exec "$CLIENT" sh -c "
  git config --global url.'https://link-assistant-router/git/'.insteadOf 'https://github.com/'
  git config --global http.'https://link-assistant-router/'.sslCAInfo /etc/hive-mind-router-ca.pem
  git config --global http.'https://link-assistant-router/'.extraHeader 'Authorization: Bearer $TOKEN'
  git config --global user.name probe; git config --global user.email probe@example.com
  git clone -q --depth 1 --no-checkout --single-branch --branch $BRANCH https://github.com/link-assistant/hive-mind /tmp/repo
  cd /tmp/repo && git checkout -q --orphan probe-rewrite && git commit --allow-empty -q -m 'probe: unrelated history'
"

docker exec "$CLIENT" sh -c "git config --global http.'https://link-assistant-router/'.extraHeader 'Authorization: Bearer $SCOPED'"

echo "== forced push, client packet trace =="
docker exec -e GIT_TRACE_PACKET=1 "$CLIENT" sh -c "cd /tmp/repo && git push --force origin HEAD:refs/heads/$BRANCH" 2>&1 \
  | grep -E "packet:.*(refs/heads|report-status|force|capabilities)" | head -10 | redact

echo
echo "== router verdict =="
docker exec -e GIT_TRACE_PACKET=1 "$CLIENT" sh -c "cd /tmp/repo && git push --force origin HEAD:refs/heads/$BRANCH" 2>&1 | grep -viE "^[0-9]+:.*packet" | head -6 | redact

echo
echo "== control: the branch on the remote =="
git ls-remote https://github.com/link-assistant/hive-mind "refs/heads/$BRANCH"
