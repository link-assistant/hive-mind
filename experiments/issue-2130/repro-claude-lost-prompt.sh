#!/usr/bin/env bash
# Issue #2130 — `formal-ai with claude` and the "Input must be provided either
# through stdin or as a prompt argument when using --print" failure.
#
# Step 1 captures, via a fake `claude` first on PATH, the exact argv that
# `formal-ai with claude` builds from the production command line
# (docs/case-studies/issue-2130/data/tool-logs/claude-02-FTn7sm.log:216).
# Step 2 replays that argv against the real `claude` with a deliberately
# invalid model, so the run fails fast without spending tokens, and reports
# whether it failed at argument parsing or got as far as a request.
#
# Usage: ./repro-claude-lost-prompt.sh

set -u
W="$(mktemp -d /tmp/fa-claude-repro-XXXXXX)"
SHIM="$(mktemp -d /tmp/fa-claude-shim-XXXXXX)"
ARGV="$W/argv"
PROMPT='Issue to solve: https://github.com/konard/test-hello-world/issues/1
Your prepared branch: issue-1-abc
Proceed.'

cat >"$SHIM/claude" <<SHIMEOF
#!/usr/bin/env bash
printf '%s\0' "\$@" >"$ARGV"
echo "stdin: \$(timeout 2 cat | wc -c) bytes" >"$W/stdin"
exit 0
SHIMEOF
chmod +x "$SHIM/claude"

cd "$W" || exit 1
echo '== step 1: what does `formal-ai with claude` build? =='
PATH="$SHIM:$PATH" timeout 90 formal-ai with claude \
  --output-format stream-json --verbose --dangerously-skip-permissions \
  --model formal-ai --strict-mcp-config --mcp-config "$W/mcp.json" \
  --disallowedTools AskUserQuestion CronCreate CronDelete CronList EnterPlanMode \
  ExitPlanMode NotebookEdit PushNotification RemoteTrigger ScheduleWakeup \
  -p "$PROMPT" </dev/null >/dev/null 2>&1

[ -s "$ARGV" ] || {
  echo "   the tool was never invoked"
  exit 1
}
echo "   argv:"
tr '\0' '\n' <"$ARGV" | sed 's/^/     /'
cat "$W/stdin" | sed 's/^/   /'
if tr '\0' '\n' <"$ARGV" | grep -qF 'Issue to solve'; then
  echo "   => the prompt IS present in argv"
else
  echo "   => the prompt is NOT in argv"
fi

echo
echo '== step 2: replay that argv against the real claude =='
# Swap the model for an invalid one so nothing is billed, and drop the mcp
# config (the shim never created the file).
mapfile -d '' -t A <"$ARGV"
OUT=()
skip=0
for a in "${A[@]}"; do
  if [ "$skip" = 1 ]; then
    skip=0
    continue
  fi
  case "$a" in
  --mcp-config)
    skip=1
    continue
    ;;
  --strict-mcp-config) continue ;;
  formal-ai)
    OUT+=("nonexistent-model-xyz")
    continue
    ;;
  esac
  OUT+=("$a")
done
timeout 60 claude "${OUT[@]}" </dev/null 2>&1 | head -5 | sed 's/^/   /'

echo
echo "workspace: $W"
