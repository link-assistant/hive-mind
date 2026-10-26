#!/usr/bin/env bash
# Use the installed, real Codex CLI with synthetic API-key login, no provider IO.
# This tests storage operations only, not the OAuth refresh concurrency contract.
set -euo pipefail
probe_root=$(mktemp -d /tmp/hive-3785-cli-XXXXXX)
probe_name="hive-3785-codex-$$"
probe_cli=${CODEX_PROBE_BINARY:-/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex}
cleanup() {
  docker rm -f "$probe_name" >/dev/null 2>&1 || true
  rm -rf "$probe_root"
}
trap cleanup EXIT
mkdir -p "$probe_root/state" "$probe_root/home"
printf '{}\n' > "$probe_root/state/auth.json"
docker run -d --name "$probe_name" --cgroup-parent / --pids-limit 32 --network none \
  --ulimit data=536870912:536870912 \
  --mount "type=bind,source=$probe_cli,target=/usr/local/bin/codex,readonly" \
  --mount "type=bind,source=$probe_root/state/auth.json,target=/state/auth.json" \
  -e HOME=/tmp/home -e CODEX_HOME=/state \
  alpine:3.22 sh -c 'mkdir -p "$HOME"; ulimit -v 524288; exec sleep 300' >/dev/null
docker exec "$probe_name" codex --version
printf 'synthetic-provider-key\n' | docker exec -i "$probe_name" codex login --with-api-key >/dev/null
if docker exec "$probe_name" codex logout > "$probe_root/logout.log" 2>&1; then
  echo 'Unexpected successful logout with a file mounted auth.json' >&2
  exit 1
fi
if ! grep -Eiq 'Device or resource busy|os error 16' "$probe_root/logout.log"; then
  echo 'Logout failed for an unexpected reason' >&2
  exit 1
fi
test -f "$probe_root/state/auth.json"
echo 'REPRODUCED: real Codex logout cannot remove the file-mounted credential.'
docker rm -f "$probe_name" >/dev/null

# The directory-mounted control supports deletion and re-creation. This alone
# does not separate config or serialize refreshes and is not a production fix.
docker run -d --name "$probe_name" --cgroup-parent / --pids-limit 32 --network none \
  --user "$(id -u):$(id -g)" --ulimit data=536870912:536870912 \
  --mount "type=bind,source=$probe_cli,target=/usr/local/bin/codex,readonly" \
  --mount "type=bind,source=$probe_root/state,target=/state" \
  -e HOME=/tmp/home -e CODEX_HOME=/state \
  alpine:3.22 sh -c 'mkdir -p "$HOME"; ulimit -v 524288; exec sleep 300' >/dev/null
docker exec "$probe_name" codex logout >/dev/null
test ! -e "$probe_root/state/auth.json"
printf 'synthetic-new-provider-key\n' | docker exec -i "$probe_name" codex login --with-api-key >/dev/null
test -f "$probe_root/state/auth.json"
echo 'CONTROL PASSED: real Codex can delete and recreate directory-mounted credentials.'
