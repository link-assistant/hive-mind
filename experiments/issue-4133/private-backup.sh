#!/usr/bin/env bash
# Run on a Docker host with busybox:1.37 available locally.
# Set HIVE_BACKUP_SMOKE_SSH=1 and use Python with Paramiko installed
# to stream the same test through an authenticated OpenSSH client on loopback.
set -euo pipefail
umask 077

experiment_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
manager=${1:-$experiment_dir/../../src/hive-manager/cli.sh}
image=${HIVE_BACKUP_SMOKE_IMAGE:-busybox:1.37}
fixture=$(mktemp -d)
container=hive-private-backup-${fixture##*.}
ssh_pid=''
cleanup() {
  if [[ $ssh_pid ]]; then
    kill "$ssh_pid" 2>/dev/null || :
    wait "$ssh_pid" 2>/dev/null || :
  fi
  docker container rm -v "$container" >/dev/null 2>&1 || :
  docker volume rm "$container" >/dev/null 2>&1 || :
  # The Docker fixture may have created root-owned files in the disposable volume,
  # while the host fixture is owned by this script's account.
  python3 -c 'import shutil, sys; shutil.rmtree(sys.argv[1])' "$fixture"
}
trap cleanup EXIT

cli=(bash "$manager")
if [[ ${HIVE_BACKUP_SMOKE_SSH:-0} == 1 ]]; then
  mkdir "$fixture/bin"
  ln -s "$(realpath -- "$manager")" "$fixture/bin/hive-manager"
  ssh-keygen -q -t ed25519 -N '' -f "$fixture/client"
  "${HIVE_BACKUP_PYTHON:-python3}" "$experiment_dir/ssh-transport.py" "$fixture/client.pub" "$fixture/bin:$PATH" > "$fixture/ssh-server" &
  ssh_pid=$!
  for (( attempt=0; attempt<50; attempt++ )); do
    if [[ $(wc -l < "$fixture/ssh-server") -ge 2 ]]; then break; fi
    kill -0 "$ssh_pid"
    sleep 0.1
  done
  port=$(head -n1 "$fixture/ssh-server")
  tail -n1 "$fixture/ssh-server" > "$fixture/known_hosts"
  cli+=(--host fixture@127.0.0.1 --ssh-config /dev/null --ssh-port "$port"
    --ssh-option "IdentityFile=$fixture/client" --ssh-option IdentitiesOnly=yes
    --ssh-option "UserKnownHostsFile=$fixture/known_hosts" --ssh-option StrictHostKeyChecking=yes)
fi

mkdir -p "$fixture"/state/{claude,codex,hive} "$fixture/bind"
printf '%s\n' 'provider marker' > "$fixture/state/claude/marker"
printf '%s\n' 'excluded marker' > "$fixture/state/codex/marker"
printf '%s\n' 'common marker' > "$fixture/state/hive/marker"
printf '%s\n' 'bind marker' > "$fixture/bind/marker"
docker run --pull never --network none --name "$container" \
  --mount "type=bind,source=$fixture/bind,target=/operator-bind,readonly" \
  --mount "type=volume,source=$container,target=/operator-volume" \
  "$image" sh -ec 'mkdir /legacy; echo legacy-marker > /legacy/marker; echo volume-marker > /operator-volume/marker'

deploy=("${cli[@]}" deploy --name "$container" --state-dir "$fixture/state")
"${deploy[@]}" backup --plan --provider claude --state \
  --mount bind=/operator-bind --mount volume=/operator-volume \
  --legacy "legacy=$container:/legacy" > "$fixture/plan.json"
"${deploy[@]}" backup --plan-file - --output - < "$fixture/plan.json" > "$fixture/offline.bundle"
restore=("${cli[@]}" deploy --name "$container" --state-dir "$fixture/restore" restore --bundle)
"${restore[@]}" < "$fixture/offline.bundle"
if duplicate=$("${restore[@]}" --input "$fixture/offline.bundle" 2>&1); then
  echo 'Restore unexpectedly overwrote the destination' >&2
  exit 1
fi
[[ $duplicate == *'Restore requires a new directory'* ]]

[[ $(cat "$fixture/restore/state/claude/marker") == 'provider marker' ]]
[[ $(cat "$fixture/restore/state/hive/marker") == 'common marker' ]]
[[ $(cat "$fixture/restore/additional/bind/marker") == 'bind marker' ]]
[[ $(cat "$fixture/restore/additional/volume/marker") == volume-marker ]]
[[ $(cat "$fixture/restore/additional/legacy/marker") == legacy-marker ]]
[[ ! -e $fixture/restore/state/codex ]]
[[ $(stat -c %a "$fixture/restore/MANIFEST.json") == 600 ]]
[[ $(stat -c %a "$fixture/restore") == 700 ]]
echo 'Private deployment backup round-trip passed'
