#!/bin/sh
# Issue #2889: recover a killed Hive Mind task container by hand without
# copying its filesystem.
#
# `$ --resume <id> -- <command>` commits the whole writable layer to an image
# (start-command's docker-snapshot mode). For a Rust or Node build that is tens
# of gigabytes and half an hour of CPU. Task containers created by Hive Mind
# with the #2889 fix look for a command file first, so the same container can
# be restarted with `docker start` and a new command instead:
#
#   1. read the handoff path from the container's own command;
#   2. `docker cp` the new command into the stopped container;
#   3. `$ --resume <id>` WITHOUT a command → docker-start mode, no copy.
#
# Usage: examples/issue-2889-manual-docker-start-recovery.sh <container> <command...>
# START_COMMAND_BIN overrides the start-command binary (default `$`).
# Example: examples/issue-2889-manual-docker-start-recovery.sh 93e2bc38-… solve https://github.com/o/r/issues/1 --resume <tool-session-id>
set -eu
start_bin=${START_COMMAND_BIN:-'$'}

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <container> <command...>" >&2
  exit 2
fi
container=$1
shift

state=$(docker inspect -f '{{.State.Status}}' "$container")
if [ "$state" = running ]; then
  echo "Container $container is still running; stop it first (docker stop $container)." >&2
  exit 1
fi

handoff=$(docker inspect -f '{{json .Config.Cmd}}' "$container" | grep -o "/tmp/hive-mind-resume-command-[A-Za-z0-9._-]*" | head -n 1 || true)
if [ -z "$handoff" ]; then
  echo "Container $container was created without a resume handoff (Hive Mind before the #2889 fix)." >&2
  echo "The only in-place option is a snapshot; check free disk first:" >&2
  echo "  docker inspect --size -f '{{.SizeRw}}' $container; df -h \"\$(docker info -f '{{.DockerRootDir}}')\"" >&2
  echo "  \$ --resume $container -- <command>" >&2
  exit 1
fi

# Shell-quote each argument into one `exec` line.
script=$(mktemp)
trap 'rm -f "$script"' EXIT
printf '# Written by hand before docker start (issue #2889).\nexec' >"$script"
for arg in "$@"; do
  printf " '%s'" "$(printf '%s' "$arg" | sed "s/'/'\\\\''/g")" >>"$script"
done
printf '\n' >>"$script"

docker cp "$script" "$container:$handoff"
echo "Wrote the recovery command to $container:$handoff:"
cat "$script"

# No command after `--`: start-command restarts the same container.
"$start_bin" --resume "$container"
