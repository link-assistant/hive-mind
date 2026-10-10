#!/bin/sh
# Issue #2889: two killed containers resumed with a command at the same time
# both run `docker commit` concurrently, with no free-disk check, and leave the
# stopped original and the snapshot image behind.
#
# Usage: experiments/issue-2889-concurrent-snapshot-resume.sh [start-command binary]
set -u
B=${1:-$HOME/.bun/bin/\$}
"$B" --version 2>&1 | head -n 1
for n in snap-a snap-b; do
  "$B" --isolated docker --detached --session "$n" --image alpine:3.20 -- sh -c 'dd if=/dev/zero of=/root/big bs=1M count=256; sleep 600' >/dev/null 2>&1
done
sleep 6
docker kill snap-a snap-b >/dev/null
sleep 4
echo "writable layers: $(docker inspect --size -f '{{.Name}}={{.SizeRw}}' snap-a snap-b | tr '\n' ' ')"

since=$(date +%s)
for n in snap-a snap-b; do
  (
    t0=$(date +%s.%N)
    "$B" --resume "$n" -- sh -c 'sleep 600' >"/tmp/$n-resume.log" 2>&1
    awk -v n="$n" -v a="$t0" -v b="$(date +%s.%N)" -v s="$since" 'BEGIN { printf "%s: $ --resume ran from +%.2fs to +%.2fs\n", n, a - s, b - s }'
  ) &
done
wait
sleep 2
echo "docker events (seconds after both resumes started):"
docker events --since "$since" --until "$(date +%s)" --filter event=commit --filter event=start --format '{{.TimeNano}} {{.Action}} {{.Actor.Attributes.name}}' |
  sort | awk -v s="$since" '{ printf "  %+.2fs %s %s\n", ($1 / 1e9) - s, $2, $3 }'
grep -h "mode\|Error" /tmp/snap-a-resume.log /tmp/snap-b-resume.log
docker images 'start-command-resume/snap-*' --format '{{.Repository}}:{{.Tag}} {{.Size}}'
docker ps -a --filter name=snap- --format '{{.Names}} {{.Status}}'

docker container rm -f snap-a-resume-1 snap-b-resume-1 >/dev/null
sleep 1
echo "after the resumed containers are removed:"
docker images 'start-command-resume/snap-*' --format '  {{.Repository}}:{{.Tag}} {{.Size}}'
docker ps -a --filter name=snap- --format '  {{.Names}} {{.Status}}'

docker container rm -f snap-a snap-b >/dev/null
docker image rm start-command-resume/snap-a:1 start-command-resume/snap-b:1 >/dev/null 2>&1
rm -f /tmp/snap-a-resume.log /tmp/snap-b-resume.log
