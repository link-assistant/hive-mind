#!/usr/bin/env bash
# Run with a disposable Docker daemon and a local busybox:1.37.0 image.
set -euo pipefail

manager=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/src/hive-manager/cli.sh
work=$(mktemp -d)
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
legacy=mtproxy-classic-$port
old_name=$legacy-old
candidate=fixture-mtproxy-$port
unrelated=fixture-unrelated-$port
seed=fixture-image-$port
image=localhost/$seed
ids=()

cleanup() {
  if (( ${#ids[@]} )); then docker rm -f "${ids[@]}" >/dev/null 2>&1 || :; fi
  if [[ -f $work/owned ]]; then
    docker container ls -aq --filter "label=io.github.link-assistant.hive-manager.proxy=fixture-$port" | xargs -r docker rm -f >/dev/null
  fi
  docker image rm "$image" >/dev/null 2>&1 || :
  rm -rf -- "$work"
}
trap cleanup EXIT

for name in "$legacy" "$legacy.previous" "$legacy.candidate" "$old_name" "$candidate" "$unrelated" "$seed"; do
  if docker container ls -a --format '{{.Names}}' | grep -Fxq "$name"; then
    printf 'Fixture container name already exists: %s\n' "$name" >&2
    exit 1
  fi
done

docker image inspect busybox:1.37.0 >/dev/null
ids+=("$(docker create --name "$seed" busybox:1.37.0)")
docker commit --change='CMD ["sh", "-c", "trap \"exit 0\" TERM; while :; do sleep 1 & wait $!; done"]' "${ids[0]}" "$image" >/dev/null
mkdir "$work/legacy"
(umask 077 && printf '%032x\n' 519151 > "$work/legacy/secret")
printf 'fixture config\n' > "$work/legacy/proxy.conf"
baseline=$(docker run -d --name "$legacy" --restart unless-stopped --env WORKERS=2 \
  --stop-timeout 1 --publish "127.0.0.1:$port:443" --mount "type=bind,source=$work/legacy,target=/data" "$image")
ids+=("$baseline")
staged=$(docker create --name "$candidate" --restart unless-stopped --stop-timeout 1 --publish "127.0.0.1:$port:443" "$image")
ids+=("$staged")
unrelated_id=$(docker run -d --name "$unrelated" "$image")
ids+=("$unrelated_id")
old_id=$(docker create --name "$old_name" "$image")
ids+=("$old_id")

deploy=(bash "$manager" deploy --name "fixture-$port" --state-dir "$work/state" --no-pull --adopt proxy)
selected=(--proxy-name "$legacy" --port "$port")
trial=("${selected[@]}" --candidate "$candidate")
"${deploy[@]}" "${selected[@]}" --secret-file "$work/legacy/secret" snapshot > "$work/snapshot"
grep -q '^secret-sha256=' "$work/snapshot"
[[ ! -e $work/state ]]
touch "$work/owned"
"${deploy[@]}" "${selected[@]}" apply
cmp "$work/state/mtproxy-$port/secret" "$work/legacy/secret"
[[ $(docker inspect --format '{{index .Config.Labels "io.github.link-assistant.hive-manager.proxy"}}' "$legacy") == "fixture-$port" ]]
[[ $(docker inspect --format '{{.Id}} {{.State.Running}}' "$legacy.previous") == "$baseline false" ]]
"${deploy[@]}" "${selected[@]}" rollback
[[ $(docker inspect --format '{{.Id}} {{.State.Running}}' "$legacy") == "$baseline true" ]]

"${deploy[@]}" "${trial[@]}" trial-plan > "$work/trial"
if "${deploy[@]}" "${trial[@]}" trial - < <(printf 'unreviewed\n'); then exit 1; fi
"${deploy[@]}" "${trial[@]}" trial - < "$work/trial"
[[ $(docker inspect --format '{{.Id}} {{.State.Running}}' "$legacy") == "$staged true" ]]
"${deploy[@]}" "${selected[@]}" rollback
[[ $(docker inspect --format '{{.Id}} {{.State.Running}}' "$candidate") == "$staged false" ]]
[[ $(docker inspect --format '{{.Id}} {{.State.Running}}' "$legacy") == "$baseline true" ]]

# Reuse the reviewed plan on the same identities, then explicitly accept.
"${deploy[@]}" "${trial[@]}" trial - < "$work/trial"
"${deploy[@]}" "${selected[@]}" accept
[[ $(docker inspect --format '{{.Id}}' "$legacy") == "$staged" ]]
if docker inspect "$baseline" >/dev/null 2>&1; then exit 1; fi

for action in stop remove; do
  "${deploy[@]}" --select "$legacy" --select "$old_name" cleanup-plan "$action" > "$work/cleanup"
  "${deploy[@]}" cleanup - < "$work/cleanup"
done
[[ $(docker inspect --format '{{.Id}} {{.State.Running}}' "$unrelated") == "$unrelated_id true" ]]
[[ $(cat "$work/legacy/proxy.conf") == 'fixture config' ]]
cmp "$work/state/mtproxy-$port/secret" "$work/legacy/secret"
docker image inspect "$image" >/dev/null
printf 'Verified legacy adoption, repeatable same-port switch and rollback, and scoped Docker cleanup.\n'
