#!/usr/bin/env bash
# Exercise record adoption with start-command 0.44.0 and a local Docker daemon.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
start=$(readlink -f "$(command -v '$')")
start_lib=$(dirname "$start")/../lib
temp=$(mktemp -d)
export START_APP_FOLDER=$temp/start-command
task=hive-manager-repair-$$
name=$task-resume-1
image=start-command-resume/$task:1
uuid=40950000-1111-4000-8000-000000000001
command='trap "exit 27" TERM; printf "fixture output\n"; while :; do sleep 1; done'
manager=$repo/src/hive-manager/cli.sh

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || :
  docker image rm "$image" >/dev/null 2>&1 || :
  rm -rf -- "$temp"
}
trap cleanup EXIT

node - "$start_lib" "$uuid" "$task" "$command" "$temp/fixture.log" <<'JS'
const [lib, uuid, sessionName, command, logPath] = process.argv.slice(2);
const { ExecutionRecord, ExecutionStore } = require(`${lib}/execution-store.js`);
const store = new ExecutionStore({ appFolder: process.env.START_APP_FOLDER });
store.save(new ExecutionRecord({ uuid, status: 'executed', command, logPath, exitCode: 137, startTime: '2020-01-01T00:00:00.000Z', endTime: '2020-01-01T00:00:10.000Z', options: { isolated: 'docker', isolationMode: 'detached', sessionName, dockerContainerCleanupPolicy: 'keep' } }));
JS

docker tag debian:bookworm-slim "$image"
node - "$start_lib" "$name" "$uuid" "$task" "$image" "$command" <<'JS'
const [lib, name, uuid, task, image, command] = process.argv.slice(2);
const { execFileSync } = require('node:child_process');
const { buildCommandHandoffArgs, commandHandoffPath } = require(`${lib}/docker-command-handoff.js`);
execFileSync('docker', ['run', '-d', '--name', name, '--label', `start-command.uuid=${uuid}`, '--label', `start-command.session=${name}`, '--label', `start-command.root-session=${task}`, '--label', 'start-command.resume-count=1', '--label', `start-command.snapshot-image=${image}`, image, ...buildCommandHandoffArgs(['sh', '-c', command], commandHandoffPath(name))]);
JS

"$manager" tasks repair-records "$uuid" | jq -e '.outcomes[0].state == "eligible"'
'$' --list --output-format json | jq -e --arg id "$uuid" '.executions[] | select(.uuid == $id) | .status == "executed" and .exitCode == 137'
"$manager" tasks repair-records --apply "$uuid" | jq -e '.outcomes[0].state == "repaired"'
'$' --list --output-format json | jq -e --arg id "$uuid" --arg name "$name" '.executions[] | select(.uuid == $id) | .status == "executing" and .options.sessionName == $name and .attemptHistory[0].exitCode == 137'
"$manager" tasks repair-records --apply "$uuid" | jq -e '.outcomes == []'
docker stop "$name" >/dev/null
for ((attempt = 0; attempt < 10; attempt++)); do
  if node -e 'const {ExecutionStore} = require(process.argv[1]); const store = new ExecutionStore({appFolder: process.env.START_APP_FOLDER}); process.exit(store.get(process.argv[2])?.exitCode === 27 ? 0 : 1);' "$start_lib/execution-store.js" "$uuid"; then
    rg -Fq 'fixture output' "$temp/fixture.log"
    printf 'Task watcher finalized the repaired record with exit code 27\n'
    exit 0
  fi
  sleep 1
done
printf 'Task watcher did not finalize the repaired record\n' >&2
exit 1
