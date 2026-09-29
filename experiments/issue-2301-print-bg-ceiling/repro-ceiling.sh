#!/usr/bin/env bash
# Issue #2301: reproduce Claude Code's print-mode background-task sweep in seconds instead of 600 s.
# Requires an authenticated `claude` CLI (verified with 2.1.284). Writes stream-json to ./out/.
set -u
out="${1:-$(dirname "$0")/out}"
mkdir -p "$out" && cd "$out" || exit 1
git init -q 2>/dev/null
run() { # <name> <prompt> [env...]
  local name=$1 prompt=$2
  shift 2
  env "$@" timeout 170 claude -p "$prompt" --output-format stream-json --verbose --model haiku --dangerously-skip-permissions \
    2>"$name.stderr.txt" | while IFS= read -r line; do printf '%s\t%s\n' "$(date +%s.%N)" "$line"; done >"$name.tsv"
  echo "== $name"; cat "$name.stderr.txt"
  grep -o '"subtype":"task_notification"[^}]*"status":"[a-z]*"\|"killed":{[^}]*}\|User rejected tool use\|Request interrupted by user' "$name.tsv" | sort | uniq -c
}
AGENT='Launch exactly one Agent (subagent_type general-purpose, run_in_background true) whose prompt is: '"'"'Run the Bash command: for i in 1 2 3 4; do sleep 4; done; echo DONE — then reply with its output.'"'"' Then end your turn with the text LAUNCHED plus the agent'"'"'s reply if you have it.'
BASH_BG="Start exactly one Bash command 'sleep 90' with run_in_background set to true. Then immediately end your turn with the text STARTED, without waiting for it."
# 1. Bug: a background subagent outlives the 8 s ceiling -> stderr line, task stopped, killed.system=1,
#    synthetic "[Request interrupted by user]" inside the subagent.
run agent-ceiling "$AGENT" CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=8000
# 2. Bug: a background Bash is killed ~4 s after the result, without the stderr line and with killed.system=0.
run bash-exit "$BASH_BG" CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=20000
# 3. Fix (what hive-mind sets for one-shot solve): the same subagent runs in the foreground and completes.
run agent-fixed "$AGENT" CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=8000 CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 CLAUDE_CODE_DISABLE_WORKFLOWS=1 CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND=1
