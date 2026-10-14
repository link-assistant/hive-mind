#!/usr/bin/env bash
# Issue #2801: check start-command's own --cpu-penalty (start#189, 0.37.0+)
# against a real Docker daemon with 20 s windows.
#   MODE=none     no base CPU limit                          (lift -> NCPU)
#   MODE=launch   base limit passed as `$ --cpus BASE`       (lift -> BASE)
#   MODE=update   base limit applied later by `docker update --cpus BASE`,
#                 the way Hive Mind applies --container-cpu  (lift -> ?)
# Usage: START_BIN=/path/to/$ MODE=update BASE=4 TRIGGER=20% \
#          experiments/issue-2801-start-command-penalty-e2e.sh
set -u
START_BIN=${START_BIN:-$}
MODE=${MODE:-none}
BASE=${BASE:-4}
TRIGGER=${TRIGGER:-20%}
NCPU=$(docker info --format '{{.NCPU}}')
NAME="issue-2801-start-$MODE-$$"
EXTRA=()
[ "$MODE" = launch ] && EXTRA=(--cpus "$BASE")
log() { echo "$(date -u +%H:%M:%S) $*"; }
nano() { docker inspect -f '{{.HostConfig.NanoCpus}}' "$NAME" 2>/dev/null; }
phase() { "$START_BIN" --status "$NAME" --output-format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(JSON.stringify(j.cpuPenalty||null))}catch{console.log("unparsable")}})'; }

log "$("$START_BIN" --version | head -1); NCPU=$NCPU MODE=$MODE BASE=$BASE TRIGGER=$TRIGGER"
"$START_BIN" -i docker -d --image alpine:3 --session "$NAME" "${EXTRA[@]}" \
  --cpu-penalty --cpu-penalty-trigger "$TRIGGER" \
  --cpu-penalty-trigger-window 20s --cpu-penalty-release-window 20s \
  -- sh -c "for i in \$(seq $NCPU); do (while [ ! -f /tmp/stop ]; do :; done) & done; while [ ! -f /tmp/done ]; do sleep 1; done" | tail -3
sleep 2
[ "$MODE" = update ] && docker update --cpus "$BASE" "$NAME" >/dev/null && log "docker update --cpus $BASE applied after launch"
log "start NanoCpus=$(nano)"
for _ in $(seq 30); do
  sleep 3
  log "busy NanoCpus=$(nano) cpuPenalty=$(phase)"
  [ "$(nano)" = 2000000000 ] && break
done
docker exec "$NAME" touch /tmp/stop
log "--- container made idle"
for _ in $(seq 30); do
  sleep 3
  log "idle NanoCpus=$(nano) cpuPenalty=$(phase)"
  [ "$(nano)" != 2000000000 ] && break
done
log "--- log lines from start-command:"
LOG=$("$START_BIN" --status "$NAME" --output-format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).logPath||""))')
grep -h 'CPU penalty' "$LOG" || echo "(none in $LOG)"
docker exec "$NAME" touch /tmp/done
sleep 3
log "final NanoCpus=$(nano) cpuPenalty=$(phase)"
docker rm -f "$NAME" >/dev/null 2>&1
