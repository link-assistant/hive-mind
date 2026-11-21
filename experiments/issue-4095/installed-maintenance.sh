#!/usr/bin/env bash
# Run inside a disposable Linux container started with --init --network none
# and the installed hive-manager and Node.js on PATH.
set -euo pipefail

[[ $(id -u) == 0 ]]
[[ $(< /proc/1/comm) =~ ^(docker-init|tini)$ ]]
hive-manager --version
hive-manager deploy --help >/dev/null
hive-manager tasks report --help >/dev/null

temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
hive-manager configure-claude --settings-path "$temp/settings.json" >/dev/null
hive-manager configure-claude --settings-path "$temp/settings.json" --verify

# Emulate an orphaned browser using a shell blocked on a FIFO. The container
# init process adopts it, so this tests the real namespace and process checks.
cp "$(command -v bash)" "$temp/chromium"
mkfifo "$temp/block"
pid=$(bash -c '"$1/chromium" -c "exec 3<>\"\$1\"; read -r -u 3" browser "$1/block" --headless --remote-debugging-pipe </dev/null >/dev/null 2>&1 & echo $!' _ "$temp")
[[ $pid =~ ^[1-9][0-9]*$ ]]
report=$(hive-manager tasks check-browser "$pid" --detached)
approval=$(node -e '
  const report = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  if (!report.reparented || report.signaled || !/^sha256:[a-f0-9]{64}$/.test(report.approval)) process.exit(1);
  process.stdout.write(report.approval);
' <<< "$report")
if hive-manager tasks check-browser "$pid" --detached --terminate "sha256:$(printf '%064d' 0)"; then
  echo 'Expected an unreviewed approval to be rejected' >&2
  exit 1
fi
kill -0 "$pid"

hive-manager tasks check-browser "$pid" --detached --terminate "$approval" | node -e '
  const report = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  if (!report.signaled) process.exit(1);
'
for (( attempt=0; attempt<20; attempt++ )); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo 'Verified offline root maintenance and receipt-approved browser termination'
    exit 0
  fi
  sleep 0.05
done
exit 1
