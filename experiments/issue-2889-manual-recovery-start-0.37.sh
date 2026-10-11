#!/bin/sh
# Issue #2889: check examples/issue-2889-manual-docker-start-recovery.sh against
# a container that start-command >= 0.37 created without the Hive Mind prefix.
# Usage: START_COMMAND_BIN=/path/to/$ experiments/issue-2889-manual-recovery-start-0.37.sh
set -eu
start_bin=${START_COMMAND_BIN:-'$'}
name="issue-2889-manual-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$start_bin" --isolated docker --detached --session "$name" --image alpine:3.20 -- sh -c 'echo built > /f; echo FIRST-RUN; sleep 600' >/dev/null
sleep 3
id=$(docker inspect -f '{{.Id}}' "$name")
docker kill "$name" >/dev/null
sleep 3
START_COMMAND_BIN="$start_bin" sh "$(dirname "$0")/../examples/issue-2889-manual-docker-start-recovery.sh" "$name" sh -c 'cat /f; echo "MANUAL-RECOVERY it'\''s ok"; sleep 5' | grep -E '^(Wrote|exec)'
sleep 2
docker logs "$name" 2>&1 | tail -n 2
[ "$(docker inspect -f '{{.Id}}' "$name")" = "$id" ] && echo "PASS: same container"
[ -z "$(docker images -q "start-command-resume/$name")" ] && echo "PASS: no snapshot image"
docker logs "$name" 2>&1 | grep -q "MANUAL-RECOVERY it's ok" && echo "PASS: recovery command ran with the killed container's files"
