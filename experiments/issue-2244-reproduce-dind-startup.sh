#!/usr/bin/env bash
set -euo pipefail

# Reproduce issue #2244 against the immutable amd64 image reported by the
# incident. The first probe follows Hive Mind's writable-layer start gate. The
# second deliberately sends SIGKILL at the incident's ~5.6 second mark so the
# resulting Docker state and console can be compared with the preserved log.

image="${ISSUE_2244_IMAGE:-docker.io/konard/hive-mind-dind@sha256:b5e71481abcc540a881d805007051211c09661911379f40e248fa4bd064fe6d7}"
output_dir="${1:-docs/case-studies/issue-2244/evidence/reproduction}"
size_probe_seconds="${ISSUE_2244_SIZE_PROBE_SECONDS:-10}"
normal_container="hive-mind-issue-2244-normal"
fixed_container="hive-mind-issue-2244-fixed"
killed_container="hive-mind-issue-2244-killed"
verbose_container="hive-mind-issue-2244-verbose"
gate="/tmp/hive-mind-disk-baseline-issue-2244"
fixed_gate="/tmp/hive-mind-disk-baseline-issue-2244-fixed"
killed_gate="/tmp/hive-mind-disk-baseline-issue-2244-killed"

mkdir -p "$output_dir"

cleanup() {
  docker rm -f "$normal_container" "$fixed_container" "$killed_container" "$verbose_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

inspect_container() {
  local container="$1"
  local prefix="$2"

  docker inspect "$container" >"$output_dir/${prefix}-inspect.json"
  docker logs "$container" >"$output_dir/${prefix}-console.log" 2>&1 || true
  docker cp "$container:/var/log/dockerd.log" "$output_dir/${prefix}-dockerd.log" >/dev/null 2>&1 || true
}

echo "[probe] normal gated startup"
rm -f "$output_dir/normal-size-rw-timeout.txt"
normal_id="$({ docker run -d --privileged \
  --name "$normal_container" \
  -e DIND_STORAGE_DRIVER=fuse-overlayfs \
  "$image" \
  sh -c 'gate='"'"$gate"'"'; i=0; while [ ! -e "$gate" ] && [ "$i" -lt 300 ]; do i=$((i+1)); sleep 0.1; done; rm -f "$gate"; printf "WORKLOAD_REACHED i=%s\n" "$i"'; } 2>&1)"
echo "[probe] normal container id: $normal_id"

# Match the parent launch sequence, but keep this diagnostic harness from
# inheriting issue #2244's deadlock. Record whether `docker inspect --size`
# completes within a short observation window, then stop only that client
# process and release the child gate. The production path gets its own tested
# bound; this script exists to demonstrate the pre-fix behavior safely.
docker inspect --size -f '{{.SizeRw}}' "$normal_container" >"$output_dir/normal-size-rw.txt" 2>"$output_dir/normal-size-rw.stderr" &
size_pid="$!"
size_completed=false
for _ in $(seq 1 "$size_probe_seconds"); do
  if ! kill -0 "$size_pid" 2>/dev/null; then
    wait "$size_pid" || true
    size_completed=true
    break
  fi
  sleep 1
done
if [ "$size_completed" != true ]; then
  printf 'timed out after %ss\n' "$size_probe_seconds" >"$output_dir/normal-size-rw-timeout.txt"
  kill "$size_pid" >/dev/null 2>&1 || true
  wait "$size_pid" || true
fi

# docker exec can race the entrypoint handoff on a very fast image, so retry
# briefly even though it is normally available as soon as the container runs.
for attempt in $(seq 1 60); do
  if docker exec "$normal_container" sh -c "touch '$gate'" >/dev/null 2>&1; then
    echo "[probe] normal gate released after attempt $attempt"
    break
  fi
  sleep 1
done
normal_exit="$(docker wait "$normal_container")"
inspect_container "$normal_container" normal
echo "[probe] normal exit: $normal_exit"

echo "[probe] bounded production writable-layer probe"
fixed_id="$({ docker run -d --privileged \
  --name "$fixed_container" \
  -e DIND_STORAGE_DRIVER=fuse-overlayfs \
  "$image" \
  sh -c 'gate='"'"$fixed_gate"'"'; i=0; while [ ! -e "$gate" ] && [ "$i" -lt 300 ]; do i=$((i+1)); sleep 0.1; done; rm -f "$gate"; printf "WORKLOAD_REACHED i=%s\n" "$i"'; } 2>&1)"
echo "[probe] fixed container id: $fixed_id"
node --input-type=module - "$fixed_container" >"$output_dir/fixed-size-probe.log" <<'NODE'
import { getDockerContainerWritableLayerSize } from './src/isolation-runner.lib.mjs';

const startedAt = Date.now();
const bytes = await getDockerContainerWritableLayerSize(process.argv[2], true);
console.log(JSON.stringify({ bytes, durationMilliseconds: Date.now() - startedAt }));
NODE
docker exec "$fixed_container" sh -c "touch '$fixed_gate'" >/dev/null
fixed_exit="$(docker wait "$fixed_container")"
inspect_container "$fixed_container" fixed
echo "[probe] fixed exit: $fixed_exit"

echo "[probe] deliberate SIGKILL during DinD startup"
killed_id="$({ docker run -d --privileged \
  --name "$killed_container" \
  -e DIND_STORAGE_DRIVER=fuse-overlayfs \
  "$image" \
  sh -c 'gate='"'"$killed_gate"'"'; i=0; while [ ! -e "$gate" ] && [ "$i" -lt 300 ]; do i=$((i+1)); sleep 0.1; done; printf "WORKLOAD_REACHED i=%s\n" "$i"'; } 2>&1)"
echo "[probe] killed container id: $killed_id"
sleep 5.6
docker kill --signal KILL "$killed_container" >/dev/null
killed_exit="$(docker wait "$killed_container")"
inspect_container "$killed_container" killed
echo "[probe] killed exit: $killed_exit"

echo "[probe] opt-in verbose DinD diagnostics"
verbose_id="$({ docker run -d --privileged \
  --name "$verbose_container" \
  -e DIND_STORAGE_DRIVER=fuse-overlayfs \
  -e DIND_LOG_FILE=/dev/stderr \
  "$image" \
  sh -c 'printf "VERBOSE_WORKLOAD_REACHED\n"'; } 2>&1)"
echo "[probe] verbose container id: $verbose_id"
verbose_exit="$(docker wait "$verbose_container")"
inspect_container "$verbose_container" verbose
echo "[probe] verbose exit: $verbose_exit"

node --input-type=module - "$output_dir" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const outputDir = process.argv[2];
const summarize = prefix => {
  const [record] = JSON.parse(fs.readFileSync(path.join(outputDir, `${prefix}-inspect.json`), 'utf8'));
  const state = record.State;
  return {
    name: record.Name,
    image: record.Config.Image,
    status: state.Status,
    exitCode: state.ExitCode,
    oomKilled: state.OOMKilled,
    error: state.Error,
    startedAt: state.StartedAt,
    finishedAt: state.FinishedAt,
    durationMilliseconds: Date.parse(state.FinishedAt) - Date.parse(state.StartedAt),
  };
};

const result = {
  generatedAt: new Date().toISOString(),
  normal: summarize('normal'),
  boundedProbe: {
    ...summarize('fixed'),
    ...JSON.parse(fs.readFileSync(path.join(outputDir, 'fixed-size-probe.log'), 'utf8').trim().split(/\r?\n/).at(-1)),
  },
  deliberateSigkill: summarize('killed'),
  verboseDiagnostics: {
    ...summarize('verbose'),
    consoleIncludesDockerd: /level=(info|warning|error)|time="/.test(fs.readFileSync(path.join(outputDir, 'verbose-console.log'), 'utf8')),
  },
  normalSizeProbe: {
    completed: !fs.existsSync(path.join(outputDir, 'normal-size-rw-timeout.txt')),
    value: fs.readFileSync(path.join(outputDir, 'normal-size-rw.txt'), 'utf8').trim() || null,
  },
};
fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
NODE
