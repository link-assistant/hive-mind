#!/usr/bin/env bash
# Exercise the manager against a real Docker daemon using a small fixture image.
# The fixture stubs the stock Hive Mind admission command, with no credentials.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
temp=$(mktemp -d)
name=hive-manager-fixture-$$
image=$name:local
manager=$repo/src/hive-manager.sh
managed=("$manager" deploy --name "$name" --state-dir "$temp/state folder")

cleanup() {
  docker rm -f "$name" "$name.rollback" "$name.previous" >/dev/null 2>&1 || :
  docker image rm "$image" >/dev/null 2>&1 || :
  rm -rf -- "$temp"
}
trap cleanup EXIT

docker build --tag "$image" - <<'DOCKERFILE'
FROM debian:bookworm-slim
RUN useradd --create-home --uid 1001 box && \
    printf '#!/bin/sh\nexit 0\n' >/usr/local/bin/hive && \
    chmod +x /usr/local/bin/hive && \
    mkdir -p /home/box/.codex /home/box/.claude && \
    printf 'seeded\n' >/home/box/.codex/config.toml && \
    printf '{}\n' >/home/box/.claude/settings.json && \
    printf '#!/bin/sh\n[ "$1" = --dry-run ] && exit 3\nexec sleep infinity\n' >/usr/local/bin/hive-telegram-bot && \
    chmod +x /usr/local/bin/hive-telegram-bot
DOCKERFILE

apply=("${managed[@]}" --no-pull --image "$image" apply)
"${apply[@]}" -- sleep infinity
first=$(docker inspect --format '{{.Id}}' "$name")
[[ $("${managed[@]}" exec -- id -un) == box ]]
[[ $("${managed[@]}" exec -- bash -c 'cat "$HOME/.codex/config.toml"') == seeded ]]
[[ $("${managed[@]}" exec -- bash -c 'cat "$HOME/.claude/settings.json"') == '{}' ]]
"${managed[@]}" exec -- bash -c 'printf identity > "$GIT_CONFIG_GLOBAL"'
"${managed[@]}" exec -- bash -c 'printf persisted > "$HOME/.codex/check"'
"${apply[@]}" -- sleep infinity
second=$(docker inspect --format '{{.Id}}' "$name")
[[ $first != "$second" ]]
[[ $(docker inspect --format '{{.Id}}' "$name.rollback") == "$first" ]]
[[ $("${managed[@]}" exec -- bash -c 'cat "$HOME/.codex/check"') == persisted ]]
[[ $("${managed[@]}" exec -- bash -c 'cat "$GIT_CONFIG_GLOBAL"') == identity ]]

printf 'TELEGRAM_BOT_TOKEN=fixture\n' > "$temp/env"
if "${managed[@]}" --no-pull --image "$image" --env-file "$temp/env" apply; then
  echo 'Expected bot configuration admission to reject the fixture' >&2
  exit 1
fi
[[ $(docker inspect --format '{{.Id}} {{.State.Status}}' "$name") == "$second running" ]]

if "${apply[@]}" -- false; then
  echo 'Expected failed candidate to fail the rollout' >&2
  exit 1
fi
[[ $(docker inspect --format '{{.Id}} {{.State.Status}}' "$name") == "$second running" ]]
[[ $(docker inspect --format '{{.Id}}' "$name.rollback") == "$first" ]]
"${managed[@]}" rollback
[[ $(docker inspect --format '{{.Id}} {{.State.Status}}' "$name") == "$first running" ]]
"${managed[@]}" restart
"${managed[@]}" stop
"${managed[@]}" start
"${managed[@]}" status
echo 'Docker lifecycle smoke passed'
