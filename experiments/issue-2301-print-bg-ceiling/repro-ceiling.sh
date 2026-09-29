#!/usr/bin/env bash
# Issue #2301: reproduce Claude Code's print-mode background-task sweep in seconds instead of 600 s,
# then show hive-mind's handling: a higher ceiling, and a same-session resume when it is still hit.
# Requires an authenticated `claude` CLI (verified with 2.1.284). Writes stream-json to ./out/.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/out}"
mkdir -p "$out" && cd "$out" || exit 1
git init -q 2>/dev/null
run() { # <name> <prompt> <ceiling-ms> [extra claude args...]
  local name=$1 prompt=$2 ceiling=$3
  shift 3
  CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=$ceiling timeout 170 claude -p "$prompt" --output-format stream-json --verbose --model haiku --dangerously-skip-permissions "$@" \
    2>"$name.stderr.txt" | while IFS= read -r line; do printf '%s\t%s\n' "$(date +%s.%N)" "$line"; done >"$name.tsv"
  echo "== $name"; cat "$name.stderr.txt"
  grep -o '"subtype":"task_notification"[^}]*"status":"[a-z]*"\|"killed":{[^}]*}\|User rejected tool use\|Request interrupted by user' "$name.tsv" | sort | uniq -c
}
AGENT='Launch exactly one Agent (subagent_type general-purpose, run_in_background true) whose prompt is: '"'"'Run the Bash command: for i in 1 2 3 4; do sleep 4; done; echo DONE — then reply with its output.'"'"' Then end your turn with the text LAUNCHED plus the agent'"'"'s reply if you have it.'
BASH_BG="Start exactly one Bash command 'sleep 90' with run_in_background set to true. Then immediately end your turn with the text STARTED, without waiting for it."
# 1. Bug: a background subagent outlives the 8 s ceiling -> stderr line, task stopped, killed.system=1,
#    synthetic "[Request interrupted by user]" inside the subagent, and still result: success.
run agent-ceiling "$AGENT" 8000
# 2. Bug: a background Bash is killed ~4 s after the result, without the stderr line and with killed.system=0.
run bash-exit "$BASH_BG" 20000
# 3. hive-mind, part 1: a higher ceiling (4x the default in production) lets the same background
#    subagent finish; it wakes the main thread with its reply. Background work stays enabled.
run agent-raised "$AGENT" 40000
# 4. hive-mind, part 2: the ceiling was still hit in run 1, so resume that session with the prompt
#    solve builds (timeout, not the user; which tasks; where their partial output is).
{ read -r sid; prompt=$(cat); } < <(node "$here/continuation-prompt.mjs" agent-ceiling)
printf '%s\n' "$prompt" >agent-resumed.prompt.txt
run agent-resumed "$prompt" 40000 --resume "$sid"
