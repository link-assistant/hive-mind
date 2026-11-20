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
proxy_name=$name-proxy

cleanup() {
  docker rm -f "$name" "$name.rollback" "$name.previous" "$proxy_name" "$proxy_name.previous" >/dev/null 2>&1 || :
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
CMD ["sleep","infinity"]
DOCKERFILE

apply=("${managed[@]}" --no-pull --image "$image" apply)
"${apply[@]}" -- sleep infinity
first=$(docker inspect --format '{{.Id}}' "$name")
[[ $("${managed[@]}" exec -- id -un) == box ]]
[[ $("${managed[@]}" exec -- bash -c 'cat "$HOME/.codex/config.toml"') == seeded ]]
[[ $("${managed[@]}" exec -- bash -c 'cat "$HOME/.claude/settings.json"') == '{}' ]]
"${managed[@]}" exec -- bash -c 'printf identity > "$GIT_CONFIG_GLOBAL"'
"${managed[@]}" exec -- bash -c 'printf persisted > "$HOME/.codex/check"'
"${managed[@]}" exec -- bash -c 'printf log > /tmp/start-command/logs/fixture.log'
"${apply[@]}" -- sleep infinity
second=$(docker inspect --format '{{.Id}}' "$name")
[[ $first != "$second" ]]
[[ $(docker inspect --format '{{.Id}}' "$name.rollback") == "$first" ]]
[[ $("${managed[@]}" exec -- bash -c 'cat "$HOME/.codex/check"') == persisted ]]
[[ $("${managed[@]}" exec -- bash -c 'cat "$GIT_CONFIG_GLOBAL"') == identity ]]
[[ $("${managed[@]}" exec -- cat /tmp/start-command/logs/fixture.log) == log ]]

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
"${managed[@]}" diagnose | grep 'OOM: false'

docker stop "$name" >/dev/null
docker rename "$name" "$name.previous"
"${managed[@]}" recover
[[ $(docker inspect --format '{{.Id}} {{.State.Status}}' "$name") == "$first running" ]]

port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
proxy=("${managed[@]}" --no-pull proxy --port "$port" --proxy-name "$proxy_name" --image "$image")
printf '0123456789abcdef0123456789abcdef\n' > "$temp/proxy-key"
"${proxy[@]}" --secret-file "$temp/proxy-key" apply
[[ $("${proxy[@]}" --public-host proxy.example.test link) == "tg://proxy?server=proxy.example.test&port=$port&secret=dd0123456789abcdef0123456789abcdef" ]]
"${proxy[@]}" update
"${proxy[@]}" stop
"${proxy[@]}" remove
[[ -f "$temp/state folder/mtproxy-$port/secret" ]]
echo 'Docker lifecycle smoke passed'
