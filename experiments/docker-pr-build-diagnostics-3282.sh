#!/usr/bin/env bash
# Issue #3282: exercise scripts/docker-pr-build.sh's resource sampler and exit
# diagnostics with a fake `docker`. Usage: experiments/docker-pr-build-diagnostics-3282.sh [ok|term]
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
cat > "$work/bin/docker" <<'FAKE'
#!/usr/bin/env bash
[ "$1" = images ] && { echo REPOSITORY; exit 0; }
sleep 3; echo "fake docker $*"
FAKE
chmod +x "$work/bin/docker"
cp "$repo/Dockerfile" "$repo/Dockerfile.dind" "$work/"
cd "$work"
start=$(date +%s)
if [ "${1:-ok}" = term ]; then
  PATH="$work/bin:$PATH" DOCKER_PR_RESOURCE_SAMPLE_SECONDS=1 setsid bash "$repo/scripts/docker-pr-build.sh" > out.log 2>&1 &
  pid=$!; sleep 2; kill -TERM -- "-$pid"; wait "$pid"; echo "exit=$?"
else
  # Reading through a pipe shows whether a leftover sampler keeps stdout open.
  PATH="$work/bin:$PATH" DOCKER_PR_RESOURCE_SAMPLE_SECONDS=20 bash "$repo/scripts/docker-pr-build.sh" 2>&1 | cat > out.log; echo "exit=${PIPESTATUS[0]}"
fi
echo "elapsed=$(( $(date +%s) - start ))s"; grep -E 'resources|SIGTERM|fake docker|completed' out.log
