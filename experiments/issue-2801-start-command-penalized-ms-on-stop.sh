#!/usr/bin/env bash
# Issue #2801: does start-command's `penalizedMs` count the penalized time up to
# a graceful monitor stop? With 4-minute windows the monitor ticks every 30 s
# (min window / 8, clamped to 30 s), so a SIGTERM sent STOP_AFTER seconds after
# the cap lands before the next tick. The graceful-stop path lifts the cap and
# publishes `penalizedMs`; it should be at least STOP_AFTER s. The script also
# reports how long the graceful stop takes to lift the cap.
# Usage: START_BIN=/path/to/$ [WINDOW=4m] [STOP_AFTER=15] \
#          experiments/issue-2801-start-command-penalized-ms-on-stop.sh
set -u
START_BIN=${START_BIN:-$}
WINDOW=${WINDOW:-4m}
STOP_AFTER=${STOP_AFTER:-15}
NCPU=$(docker info --format '{{.NCPU}}')
NAME="issue-2801-start-pms-$$"
MONITOR="(cpu-penalty-monitor.js|__start-cpu-monitor).*$NAME"
log() { echo "$(date -u +%H:%M:%S) $*"; }
nano() { docker inspect -f '{{.HostConfig.NanoCpus}}' "$NAME" 2>/dev/null; }
phase() { "$START_BIN" --status "$NAME" --output-format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).cpuPenalty;console.log(p?`${p.phase} limit=${p.limitCpus} count=${p.penaltyCount} penalizedMs=${p.penalizedMs}`:"null")}catch{console.log("unparsable")}})'; }

log "$("$START_BIN" --version 2>/dev/null | sed -n 1p); NCPU=$NCPU WINDOW=$WINDOW STOP_AFTER=${STOP_AFTER}s"
"$START_BIN" -i docker -d --image alpine:3 --session "$NAME" \
  --cpu-penalty --cpu-penalty-trigger 20% \
  --cpu-penalty-trigger-window "$WINDOW" --cpu-penalty-release-window "$WINDOW" \
  -- sh -c "for i in \$(seq $NCPU); do (while :; do :; done) & done; wait" >/dev/null
for _ in $(seq 400); do
  sleep 1
  [ "$(nano)" = 2000000000 ] && break
done
CAPPED=$(date +%s)
log "capped: NanoCpus=$(nano) $(phase)"
sleep "$STOP_AFTER"
log "before SIGTERM ($(( $(date +%s) - CAPPED )) s after the cap): $(phase)"
pkill -TERM -f "$MONITOR"
STOPPED=$(date +%s)
for _ in $(seq 60); do
  sleep 1
  [ "$(nano)" != 2000000000 ] && break
done
log "cap lifted $(( $(date +%s) - STOPPED )) s after SIGTERM: NanoCpus=$(nano)"
sleep 2
log "after graceful stop: monitor pids: '$(pgrep -f "$MONITOR" | tr '\n' ' ')' $(phase)"
docker rm -f "$NAME" >/dev/null 2>&1
