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
dind_name=$name-dind
failed=$name-failed-task

cleanup() {
  docker rm -f "$name" "$name.rollback" "$name.previous" "$name.candidate" "$proxy_name" "$proxy_name.previous" "$dind_name" "$failed" >/dev/null 2>&1 || :
  docker volume rm "$dind_name-dind-data" >/dev/null 2>&1 || :
  docker image rm "$image" >/dev/null 2>&1 || :
  rm -rf -- "$temp"
}
trap cleanup EXIT

docker build --tag "$image" - <<'DOCKERFILE'
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3-minimal && \
    rm -rf /var/lib/apt/lists/* && \
    useradd --create-home --uid 1001 box && \
    printf '#!/bin/sh\nexit 0\n' >/usr/local/bin/hive && \
    chmod +x /usr/local/bin/hive && \
    mkdir -p /home/box/.codex /home/box/.claude && \
    printf 'seeded\n' >/home/box/.codex/config.toml && \
    printf '{}\n' >/home/box/.claude/settings.json && \
    printf '#!/bin/sh\n[ "$1" = --dry-run ] && exit 3\nexec sleep infinity\n' >/usr/local/bin/hive-telegram-bot && \
    chmod +x /usr/local/bin/hive-telegram-bot
CMD ["sleep","infinity"]
DOCKERFILE

execution=40950000-1111-4000-8000-000000000002
docker run --name "$failed" --label "start-command.uuid=$execution" --label "start-command.session=$failed" "$image" \
  sh -c 'printf evidence > /tmp/task-evidence; exit 27' || [[ $? == 27 ]]
"$manager" tasks backup-container "$failed" --output "$temp/task backup"
[[ $(tar -xOzf "$temp/task backup/filesystem.tar.gz" tmp/task-evidence) == evidence ]]
preview=$("$manager" tasks cleanup-backed-up "$temp/task backup")
approval=$(sed -n 's/^Approval SHA-256: //p' <<<"$preview")
[[ $approval =~ ^[a-f0-9]{64}$ ]]
docker inspect "$failed" >/dev/null
"$manager" tasks cleanup-backed-up "$temp/task backup" --apply "$approval"
! docker inspect "$failed" >/dev/null 2>&1 || exit 1
[[ $(tar -xOzf "$temp/task backup/filesystem.tar.gz" tmp/task-evidence) == evidence ]]

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
docker exec "$name" cp /usr/bin/sleep /tmp/chromium
docker exec -d "$name" /tmp/chromium infinity
diagnostics=$("${managed[@]}" diagnose --resources)
grep -q 'OOM: false' <<< "$diagnostics"
grep -q 'LWP' <<< "$diagnostics"
grep -q 'sleep' <<< "$diagnostics"
grep -q 'Matching browser processes: 1' <<< "$diagnostics"
grep -q '/dev/shm' <<< "$diagnostics"
if docker exec "$name" test -r /sys/fs/cgroup/memory.events; then
  grep -q '^memory.events$' <<< "$diagnostics"
  grep -q '^oom_kill ' <<< "$diagnostics"
fi
if docker exec "$name" test -r /sys/fs/cgroup/pids.current; then
  grep -q '^pids.current$' <<< "$diagnostics"
fi
docker exec --user box -d "$name" perl -MSocket -e '
  socketpair(my $writer, my $reader, AF_UNIX, SOCK_STREAM, PF_UNSPEC) or die $!;
  syswrite($writer, "x" x 24000) == 24000 or die $!;
  open(my $pidfile, ">", "/tmp/hive-socket-fixture.pid") or die $!;
  print $pidfile "$$\n";
  close $pidfile;
  sleep 25;
'
socket_pid=''
for (( attempt=0; attempt<20; attempt++ )); do
  socket_pid=$(docker exec "$name" cat /tmp/hive-socket-fixture.pid 2>/dev/null) && [[ $socket_pid ]] && break
  sleep 0.1
done
[[ $socket_pid =~ ^[0-9]+$ ]]
process_diagnostics=$("${managed[@]}" diagnose --process "$socket_pid")
grep -q "^Container process $socket_pid I/O" <<< "$process_diagnostics"
grep -q '^syscr: +0$' <<< "$process_diagnostics"
grep -q '^Current syscall: ' <<< "$process_diagnostics"
grep -Eq 'fd [0-9]+ receive 24000 -> 24000, send 0 -> 0, peer send [1-9][0-9]* -> [1-9][0-9]*' <<< "$process_diagnostics"

# Simulate interruption after creating a replacement and stopping the old
# container, before it has been renamed to the rollout hold name.
rollout_candidate() {
  docker create --name "$name.candidate" \
    --label io.github.link-assistant.hive-manager.instance="$name" \
    --label io.github.link-assistant.hive-manager.predecessor="$first" \
    --label io.github.link-assistant.hive-manager.predecessor-running="$1" "$image" >/dev/null
}
rollout_candidate true
docker stop "$name" >/dev/null
"${managed[@]}" recover
[[ $(docker inspect --format '{{.Id}} {{.State.Status}}' "$name") == "$first running" ]]
! docker inspect "$name.candidate" >/dev/null 2>&1 || exit 1

# A previously stopped instance is restored in that same state.
docker stop "$name" >/dev/null
rollout_candidate false
docker rename "$name" "$name.previous"
"${managed[@]}" recover
[[ $(docker inspect --format '{{.Id}} {{.State.Status}}' "$name") == "$first exited" ]]
! docker inspect "$name.candidate" >/dev/null 2>&1 || exit 1
docker start "$name" >/dev/null

docker stop "$name" >/dev/null
docker rename "$name" "$name.previous"
"${managed[@]}" recover
[[ $(docker inspect --format '{{.Id}} {{.State.Status}}' "$name") == "$first running" ]]

docker rm -f "$name" "$name.rollback" >/dev/null
legacy=$(docker run -d --name "$name" "$image")
if "${apply[@]}" -- sleep infinity; then
  echo 'Expected external container to require explicit adoption' >&2
  exit 1
fi
"${managed[@]}" --adopt --no-pull --image "$image" apply -- sleep infinity
[[ $(docker inspect --format '{{.Id}}' "$name.rollback") == "$legacy" ]]
"${managed[@]}" rollback
[[ $(docker inspect --format '{{.Id}}' "$name") == "$legacy" ]]
"${apply[@]}" -- sleep infinity
[[ $(docker inspect --format '{{.Id}}' "$name.rollback") == "$legacy" ]]
"${apply[@]}" -- sleep infinity

"$manager" deploy --name "$dind_name" --state-dir "$temp/dind" --variant dind --no-pull --image "$image" apply -- sleep infinity
[[ $(docker inspect --format '{{.HostConfig.Privileged}}' "$dind_name") == true ]]
[[ $(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/docker"}}{{.Name}}{{end}}{{end}}' "$dind_name") == "$dind_name-dind-data" ]]

port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
proxy=("${managed[@]}" --no-pull proxy --port "$port" --proxy-name "$proxy_name" --image "$image")
printf '0123456789abcdef0123456789abcdef\n' > "$temp/proxy-key"
"${proxy[@]}" --secret-file "$temp/proxy-key" apply
"${proxy[@]}" snapshot > "$temp/proxy-baseline"
! grep -F '0123456789abcdef0123456789abcdef' "$temp/proxy-baseline" || exit 1
"${proxy[@]}" compare - < "$temp/proxy-baseline"
printf 'not-the-baseline\n' > "$temp/different-baseline"
if "${proxy[@]}" compare "$temp/different-baseline"; then
  echo 'Expected proxy snapshot comparison to reject drift' >&2
  exit 1
fi
[[ $("${proxy[@]}" --public-host proxy.example.test link) == "tg://proxy?server=proxy.example.test&port=$port&secret=dd0123456789abcdef0123456789abcdef" ]]
"${proxy[@]}" update
"${proxy[@]}" stop
"${proxy[@]}" remove
[[ -f "$temp/state folder/mtproxy-$port/secret" ]]
echo 'Docker lifecycle smoke passed'
