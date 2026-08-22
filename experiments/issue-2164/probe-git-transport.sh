#!/usr/bin/env bash
# Issue #2164 R13 — does a routed task's `git push` reach GitHub through the
# router, and does the router refuse deletions and history rewrites?
#
# Router 0.109.0 terminates git smart-HTTP at /git/{owner}/{repo}.git/... and
# parses the ref-update commands out of the `git-receive-pack` body before it
# forwards anything (src/git_proxy.rs). This probe drives that path with a real
# `git`, from a container that holds no GitHub credential of its own: auth is a
# scoped `Authorization: Bearer <task token>` header attached to the router URL
# only, and the rewrite is the documented `insteadOf`.
#
# The client image is the real task image, so git is the one a task actually runs.
#
# ⚠️  Point BRANCH at a throwaway branch, never at a branch that carries a pull
# request. The deletion is refused, but the force update is *not* (router#272),
# so it really does rewrite the branch — and GitHub closes any pull request whose
# head branch is force-pushed, permanently: reopening then fails with "state
# cannot be changed. The <branch> branch was force-pushed or recreated". That is
# how pull request #2165 for this very issue was lost. Create the branch first:
#
#   git push origin origin/main:refs/heads/probe-2164-git-transport
#
# Redacts `la_sk_…` from all output; safe to commit the log.
set -u

IMAGE=${IMAGE:-ghcr.io/link-assistant/router:0.109.0}
NET=probe-2164-git-net
ROUTER=probe-2164-git-router
CLIENT=probe-2164-git-client
CLIENT_IMAGE=${CLIENT_IMAGE:-konard/box:2.3.5}
BRANCH=${BRANCH:-probe-2164-git-transport}
WORK=$(mktemp -d)
redact() { sed -E 's/la_sk_[A-Za-z0-9._-]*/la_sk_REDACTED/g'; }

cleanup() {
  docker rm -f "$ROUTER" "$CLIENT" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== 1. router on 443 with TLS =="
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
docker exec "$ROUTER" router tls ca > "$WORK/ca.pem" || exit 1
TOKEN=$(docker exec "$ROUTER" router tokens issue --label probe-git --ttl-hours 1 --max-requests 200)
echo "token issued: $(printf %s "$TOKEN" | wc -c) chars"

echo
echo "== 2. task container: git wired to the router, no GitHub credential =="
docker run -d --name "$CLIENT" --network "$NET" \
  -v "$WORK/ca.pem:/etc/hive-mind-router-ca.pem:ro" \
  -e GIT_TERMINAL_PROMPT=0 \
  -e HOME=/home/box \
  "$CLIENT_IMAGE" sleep 900 >/dev/null || exit 1
docker exec "$CLIENT" sh -c "
  git config --global url.'https://link-assistant-router/git/'.insteadOf 'https://github.com/'
  git config --global http.'https://link-assistant-router/'.sslCAInfo /etc/hive-mind-router-ca.pem
  git config --global http.'https://link-assistant-router/'.extraHeader 'Authorization: Bearer $TOKEN'
  git config --global user.name probe; git config --global user.email probe@example.com
"
docker exec "$CLIENT" sh -c 'git config --global --list' | redact

echo
echo "== 3. clone through the router =="
docker exec "$CLIENT" sh -c "git clone --depth 1 --no-checkout --single-branch --branch $BRANCH https://github.com/link-assistant/hive-mind /tmp/repo" 2>&1 | redact | tail -3
docker exec "$CLIENT" sh -c 'cd /tmp/repo && git log --oneline -1 && git remote -v' 2>&1 | head -4

echo
echo "== 4. destructive: delete the branch (expected: refused by the router) =="
docker exec "$CLIENT" sh -c "cd /tmp/repo && git push origin :refs/heads/$BRANCH" 2>&1 | redact | head -8

echo
echo "== 5. destructive: force-update the branch to unrelated history (expected: refused) =="
# An orphan commit shares no history with the branch, so git has to ask for a
# forced update and announces it with the `force-ref-updates` capability - which
# is the signal the router's parser reads. A fast-forward is NOT destructive and
# is allowed: this repository's own commits are pushed through the router below.
docker exec "$CLIENT" sh -c "cd /tmp/repo && git checkout -q --orphan probe-rewrite && git commit --allow-empty -q -m 'probe: unrelated history' && git push --force origin HEAD:refs/heads/$BRANCH" 2>&1 | redact | head -8

echo
echo "== 6. control: the branch is untouched on the remote =="
git ls-remote https://github.com/link-assistant/hive-mind "refs/heads/$BRANCH"

echo
echo "== 7. router request log =="
docker exec "$ROUTER" sh -c 'find /data/router/requests -name requests.jsonl | head -3 | xargs -r grep -h "git" | tail -n 4' 2>&1 | cut -c1-220 | redact
