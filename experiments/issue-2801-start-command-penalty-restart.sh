#!/usr/bin/env bash
# Issue #2801: does start-command's CPU penalty survive the supervisor dying
# while a container is penalized? Kills the detached watcher and its CPU monitor
# (what a Hive Mind bot-container restart does), runs `$ --resume-all` (what the
# bot runs on startup), and checks the cap is still lifted afterwards.
# Usage: START_BIN=/path/to/$ TRIGGER=20% experiments/issue-2801-start-command-penalty-restart.sh
set -u
START_BIN=${START_BIN:-$}
TRIGGER=${TRIGGER:-20%}
NCPU=$(docker info --format '{{.NCPU}}')
NAME="issue-2801-start-restart-$$"
log() { echo "$(date -u +%H:%M:%S) $*"; }
nano() { docker inspect -f '{{.HostConfig.NanoCpus}}' "$NAME" 2>/dev/null; }
phase() { "$START_BIN" --status "$NAME" --output-format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).cpuPenalty;console.log(p?`${p.phase} limit=${p.limitCpus} count=${p.penaltyCount} penalizedMs=${p.penalizedMs}`:"null")}catch{console.log("unparsable")}})'; }
monitors() { pgrep -f "cpu-penalty-monitor.js.*$NAME" | tr '\n' ' '; }

log "$("$START_BIN" --version | head -1); NCPU=$NCPU TRIGGER=$TRIGGER"
"$START_BIN" -i docker -d --image alpine:3 --session "$NAME" \
  --cpu-penalty --cpu-penalty-trigger "$TRIGGER" \
  --cpu-penalty-trigger-window 20s --cpu-penalty-release-window 20s \
  -- sh -c "for i in \$(seq $NCPU); do (while [ ! -f /tmp/stop ]; do :; done) & done; while [ ! -f /tmp/done ]; do sleep 1; done" >/dev/null
for _ in $(seq 30); do
  sleep 3
  [ "$(nano)" = 2000000000 ] && break
done
log "penalized: NanoCpus=$(nano) $(phase) monitor pids: $(monitors)"
pkill -f "docker logs -f.* $NAME" ; pkill -f "cpu-penalty-monitor.js.*$NAME"
sleep 2
log "watcher and monitor killed; monitor pids: '$(monitors)'"
docker exec "$NAME" touch /tmp/stop
log "container made idle; waiting 30 s without a monitor"
sleep 30
log "still capped? NanoCpus=$(nano) $(phase)"
log "watcher-side processes: $(pgrep -af "$NAME" | grep -v pgrep | cut -c1-160 | tr '\n' '|')"
"$START_BIN" --resume-all --output-format json > "/tmp/$NAME.resume-all.json" 2>&1
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");try{for(const e of JSON.parse(s).executions.filter(e=>e.sessionName===process.argv[2]))console.log(`resume-all: ${e.action} state=${e.state} ${e.message}`)}catch{console.log(s)}' "/tmp/$NAME.resume-all.json" "$NAME"
sleep 2
log "after --resume-all: status=$("$START_BIN" --status "$NAME" --output-format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.status,j.exitCode,j.endTime)})')"
log "after --resume-all: processes: $(pgrep -af "$NAME" | grep -v pgrep | cut -c1-160 | tr '\n' '|')"
for _ in $(seq 20); do
  sleep 3
  log "idle NanoCpus=$(nano) $(phase)"
  [ "$(nano)" != 2000000000 ] && break
done
docker exec "$NAME" touch /tmp/done
sleep 3
docker rm -f "$NAME" >/dev/null 2>&1
