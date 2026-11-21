#!/bin/sh
# Issue #2293 item 3: does `$ --status` show that a kept container was removed?
# Starts a detached docker task that exits 1 (start-command keeps it by default),
# prints `$ --status`, removes the container by hand, prints `$ --status` again.
set -u
name="status-removal-2293-$$"
image="${1:-alpine:3.20}"
$ --version 2>/dev/null | head -1
$ --isolated docker --image "$image" --detached --session "$name" -- sh -c 'echo working; exit 1' >/dev/null 2>&1
for i in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo missing)
  [ "$state" = exited ] && break
  sleep 1
done
sleep 3
echo "--- container: $(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$name" 2>&1)"
echo "--- \$ --status before removal"
$ --status "$name"
docker rm -f "$name" >/dev/null
echo "--- container: $(docker inspect -f '{{.State.Status}}' "$name" 2>&1 | head -1)"
echo "--- \$ --status after docker rm -f"
$ --status "$name"
