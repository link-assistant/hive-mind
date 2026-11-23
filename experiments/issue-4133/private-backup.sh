#!/usr/bin/env bash
# Run on a Docker host with busybox:1.37 available locally.
set -euo pipefail
umask 077

manager=${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/src/hive-manager/cli.sh}
image=${HIVE_BACKUP_SMOKE_IMAGE:-busybox:1.37}
fixture=$(mktemp -d)
container=hive-private-backup-${fixture##*.}
cleanup() {
  docker container rm -v "$container" >/dev/null 2>&1 || :
  docker volume rm "$container" >/dev/null 2>&1 || :
  # The Docker fixture may have created root-owned files in the disposable volume,
  # while the host fixture is owned by this script's account.
  python3 -c 'import shutil, sys; shutil.rmtree(sys.argv[1])' "$fixture"
}
trap cleanup EXIT

mkdir -p "$fixture"/state/{claude,codex,hive} "$fixture/bind"
printf '%s\n' 'provider marker' > "$fixture/state/claude/marker"
printf '%s\n' 'excluded marker' > "$fixture/state/codex/marker"
printf '%s\n' 'common marker' > "$fixture/state/hive/marker"
printf '%s\n' 'bind marker' > "$fixture/bind/marker"
docker run --pull never --network none --name "$container" \
  --mount "type=bind,source=$fixture/bind,target=/operator-bind,readonly" \
  --mount "type=volume,source=$container,target=/operator-volume" \
  "$image" sh -ec 'mkdir /legacy; echo legacy-marker > /legacy/marker; echo volume-marker > /operator-volume/marker'

deploy=(bash "$manager" deploy --name "$container" --state-dir "$fixture/state")
"${deploy[@]}" backup --plan --provider claude --state \
  --mount bind=/operator-bind --mount volume=/operator-volume \
  --legacy "legacy=$container:/legacy" > "$fixture/plan.json"
"${deploy[@]}" backup --plan-file - --output - < "$fixture/plan.json" > "$fixture/offline.bundle"
restore=(bash "$manager" deploy --name "$container" --state-dir "$fixture/restore" restore --bundle)
"${restore[@]}" < "$fixture/offline.bundle"
if "${restore[@]}" --input "$fixture/offline.bundle"; then
  echo 'Restore unexpectedly overwrote the destination' >&2
  exit 1
fi

[[ $(cat "$fixture/restore/state/claude/marker") == 'provider marker' ]]
[[ $(cat "$fixture/restore/state/hive/marker") == 'common marker' ]]
[[ $(cat "$fixture/restore/additional/bind/marker") == 'bind marker' ]]
[[ $(cat "$fixture/restore/additional/volume/marker") == volume-marker ]]
[[ $(cat "$fixture/restore/additional/legacy/marker") == legacy-marker ]]
[[ ! -e $fixture/restore/state/codex ]]
[[ $(stat -c %a "$fixture/restore/MANIFEST.json") == 600 ]]
[[ $(stat -c %a "$fixture/restore") == 700 ]]
echo 'Private deployment backup round-trip passed'
