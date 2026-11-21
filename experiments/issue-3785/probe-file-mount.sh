#!/usr/bin/env bash
# Synthetic bounded Docker probe, not a passing canonical-storage release gate.
set -euo pipefail
probe_root=$(mktemp -d /tmp/hive-3785-mount-XXXXXX)
probe_name="hive-3785-mount-$$"
cleanup() {
  docker rm -f "$probe_name" >/dev/null 2>&1 || true
  rm -rf "$probe_root"
}
trap cleanup EXIT
printf 'initial' > "$probe_root/auth.json"
# This workspace has a threaded cgroup without a delegated memory controller.
# Bound the shell's address space instead; all file inputs are eleven bytes.
docker run -d --name "$probe_name" --cgroup-parent / --pids-limit 32 \
  --mount "type=bind,source=$probe_root/auth.json,target=/auth.json" \
  alpine:3.22 sh -c 'ulimit -v 65536; exec sleep 300' >/dev/null
test "$(docker exec "$probe_name" cat /auth.json)" = initial
printf 'replacement' > "$probe_root/new.json"
mv "$probe_root/new.json" "$probe_root/auth.json"
test "$(cat "$probe_root/auth.json")" = replacement
test "$(docker exec "$probe_name" cat /auth.json)" = initial
echo 'REPRODUCED: file bind mount retains the old inode after host atomic replacement.'
if docker exec "$probe_name" sh -c 'echo task-replacement > /new.json; mv /new.json /auth.json' >/dev/null 2>&1; then
  echo 'Unexpected successful replacement of mounted file' >&2
  exit 1
fi
echo 'REPRODUCED: replacing the mounted file from the task is rejected by the kernel.'

# A file symlink also fails logout/re-authentication semantics: a CLI can remove
# the link and create a private file at the same path.
mkdir "$probe_root/scope"
ln -s ../auth.json "$probe_root/scope/auth.json"
rm "$probe_root/scope/auth.json"
printf 'private' > "$probe_root/scope/auth.json"
test "$(cat "$probe_root/auth.json")" = replacement
echo 'REPRODUCED: delete/recreate of a file symlink creates independent credentials.'
