#!/usr/bin/env bash
set -euo pipefail

# Run from a Linux Docker host with a local daemon and a static C toolchain.
# The administrative container supplies an isolated host-root/system layer.
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
fixture=$(mktemp -d)
instance="hive-4117-${fixture##*.}"
id=''
cleanup() {
  if [[ $id ]]; then docker rm -f "$id" >/dev/null; fi
  rm -rf -- "$fixture"
}
trap cleanup EXIT

cat > "$fixture/helper.c" <<'C'
#include <unistd.h>
int main(int argc, char **argv) {
    alarm(90);
    if (argc > 1 && argv[1][0] == 'e') {
        while (access("/fixture/exit-foreground", F_OK) != 0) sleep(1);
        return 0;
    }
    for (;;) pause();
}
C
cc -static -Os -o "$fixture/codex" "$fixture/helper.c"
printf '%s\n' '{"mcpServers":{"unwanted":{"command":"fixture"}},"projects":{"/tmp/task":{"mcpServers":{"task-local":{"command":"fixture"}}}}}' > "$fixture/claude.json"
printf '%s\n' '{}' > "$fixture/policy.json"
config_inode=$(stat -c %i "$fixture/claude.json")
id=$(docker run --rm -d --name "$instance" --env HOME=/home/box --env START_APP_FOLDER=/home/box/task-registry \
  --mount "type=bind,source=$fixture,target=/fixture" \
  --mount "type=bind,source=$fixture/claude.json,target=/home/box/.claude.json" node:24-alpine \
  sh -eu -c '
    adduser -D -u 1001 box
    mkdir -p "$START_APP_FOLDER"
    mkdir -p /home/box/.codex/hive-mind/task /home/box/.codex/plugins /etc/codex
    printf auth > /home/box/.codex/auth.json
    printf task > /home/box/.codex/hive-mind/task/config.toml
    printf plugin > /home/box/.codex/plugins/unwanted
    printf instructions > /root/CLAUDE.md
    printf "allowed_approval_policies = [\"on-request\"]\n[hooks]\nStop = []\n" > /etc/codex/requirements.toml
    /fixture/codex app-server --managed-daemon &
    /fixture/codex exec &
    touch /fixture/ready
    wait
    sleep 90
  ')
for ((check=0; check<50; check++)); do
  [[ ! -e $fixture/ready ]] || break
  sleep 0.1
done
[[ -f $fixture/ready ]]

docker run --rm --privileged --pid=host --cgroupns=host \
  --mount "type=bind,source=$repo,target=/repo,readonly" \
  --mount "type=bind,source=$fixture,target=/fixture" \
  --mount "type=bind,source=$(command -v docker),target=/usr/local/bin/docker,readonly" \
  --mount "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock" \
  python:3.12-slim bash -eu -c '
    cli=/repo/src/hive-manager/cli.sh
    mkdir -p /root/.codex/plugins /etc/claude-code
    printf plugin > /root/.codex/plugins/unwanted
    printf "{\"hooks\":{},\"permissions\":{\"deny\":[\"Bash\"]}}" > /etc/claude-code/managed-settings.json
    tool() { bash "$cli" deploy --name "$1" "${@:2}"; }
    if tool "$1" global-tools --policy /fixture/policy.json > /fixture/global-preview.json; then
      exit 1
    fi
    test -f /root/.codex/plugins/unwanted
    docker exec "$1" test -f /home/box/.codex/plugins/unwanted
    tool "$1" global-tools --policy /fixture/policy.json --apply > /fixture/global-apply.json
    tool "$1" global-tools --policy /fixture/policy.json > /fixture/global-clean.json
    test ! -e /root/.codex/plugins/unwanted
    docker exec "$1" sh -ec "test ! -e /root/CLAUDE.md && test ! -e /root/.claude"
    test "$(docker exec "$1" cat /home/box/.codex/auth.json)" = auth
    test "$(docker exec "$1" cat /home/box/.codex/hive-mind/task/config.toml)" = task
    tool "$1" tool-services --tools codex --apply > /fixture/services-protected.json
    foreground_alive() {
      docker top "$1" -eo pid,args | python3 -c "import sys; sys.exit(not any(line.rstrip().endswith(\"codex exec\") for line in sys.stdin))"
    }
    foreground_alive "$1"
    touch /fixture/exit-foreground
    for ((check=0; check<30; check++)); do
      if ! foreground_alive "$1"; then break; fi
      sleep 0.2
    done
    docker exec "$1" sh -ec '\''
      printf "%s\n" "[{\"status\":\"executing\",\"command\":\"solve https://github.com/fixture/fixture/issues/1 --tool codex\"}]" > "$START_APP_FOLDER/executions.lino"
      printf stale > "$START_APP_FOLDER/executions.decoded.js.json"
    '\''
    tool "$1" tool-services --tools codex --apply > /fixture/services-active-record.json
    test "$(docker exec "$1" cat /home/box/task-registry/executions.decoded.js.json)" = stale
    docker exec "$1" rm /home/box/task-registry/executions.lino /home/box/task-registry/executions.decoded.js.json
    task_id=$(docker run --rm -d --label start-command.uuid=fixture alpine:3.23 sleep 90)
    cleanup_task() { docker rm -f "$task_id" >/dev/null 2>&1 || true; }
    trap cleanup_task EXIT
    tool "$1" tool-services --tools codex --apply > /fixture/services-active-task.json
    cleanup_task
    tool "$1" tool-services --tools codex > /fixture/services-preview.json
    tool "$1" tool-services --tools codex --apply > /fixture/services-apply.json
    python3 - <<PY
import json
from pathlib import Path

def read(name):
    return json.loads(Path("/fixture", name + ".json").read_text())

preview = read("global-preview")
assert not preview["clean"]
assert {"bot-user", "bot-root", "host-root", "bot-system-codex", "host-system-claude"} <= {c["context"] for c in preview["contexts"] if c["findings"]}
assert read("global-clean")["clean"]
for scope in read("global-apply")["contexts"]:
    if scope["findings"]:
        assert Path(scope["backup"]).stat().st_mode & 0o777 == 0o700
assert json.loads(Path("/etc/claude-code/managed-settings.json").read_text()) == {"permissions": {"deny": ["Bash"]}}
protected = read("services-protected")
assert not protected["signals"]
assert protected["plans"][0]["blockers"]
active = read("services-active-task")
assert not active["signals"]
assert "active or unclassified task" in active["plans"][0]["blockers"]
record = read("services-active-record")
assert not record["signals"], "Cleanup signalled a helper while a custom-store task was active"
assert "active or unclassified task" in record["plans"][0]["blockers"]
plan = read("services-preview")["plans"][0]
assert len(plan["helpers"]) == 1 and not plan["blockers"]
applied = read("services-apply")
assert applied["signals"] == [{"tool":"codex", "pid":plan["helpers"][0]["pid"], "signal":"TERM", "status":"signalled"}]
assert not applied["remaining"][0]["helpers"]
assert read("claude")["projects"]["/tmp/task"]["mcpServers"]["task-local"]["command"] == "fixture"
PY
  ' hive-4117 "$instance"
[[ $(stat -c %i "$fixture/claude.json") == "$config_inode" ]]
printf 'Docker deployment fixture passed with the original bound config inode.\n'
