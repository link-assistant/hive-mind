#!/usr/bin/env bash
# Issue #2130 — what `formal-ai with <tool>` actually hands to the tool.
#
# Puts a fake CLI (records argv + stdin byte count, exits 0) first on PATH and
# invokes `formal-ai with <tool>` in the two shapes Hive Mind uses:
#
#   A. prompt as an argument   — `formal-ai with <tool> --model M -p "<prompt>" --verbose`
#   B. prompt piped on stdin   — `echo "<prompt>" | formal-ai with <tool> --model M --verbose`
#
# Shape B is the one the round-2 `agent` run used
# (docs/case-studies/issue-2130/data/tool-logs/agent-18-V7E0Ee.log.gz:340).
#
# Usage: ./repro-with-argv.sh [tool ...]     (default: agent gemini qwen claude codex)

set -u
SHIM="$(mktemp -d /tmp/formal-ai-argv-shim-XXXXXX)"
WS="$(mktemp -d /tmp/formal-ai-argv-ws-XXXXXX)"
PROMPT='PROMPT-MARKER: Create a file hello.txt containing exactly: Hello World'
TOOLS=("$@")
[ ${#TOOLS[@]} -eq 0 ] && TOOLS=(agent gemini qwen claude codex)

for t in "${TOOLS[@]}"; do
  cat >"$SHIM/$t" <<'SHIMEOF'
#!/usr/bin/env bash
{
  echo "  argv[$#]:"
  printf '    %q\n' "$@"
  echo "  stdin: $(timeout 2 cat | wc -c) bytes"
} >&2
exit 0
SHIMEOF
  chmod +x "$SHIM/$t"
done

echo "formal-ai $(formal-ai --version 2>&1 | head -1)"
cd "$WS" || exit 1

for t in "${TOOLS[@]}"; do
  echo
  echo "########## $t"

  echo "== A: formal-ai with $t --model formal-ai -p \"<prompt>\" --verbose"
  PATH="$SHIM:$PATH" timeout 120 formal-ai with "$t" --model formal-ai -p "$PROMPT" --verbose \
    </dev/null 2>&1 >/dev/null | grep -E '^\s+(argv|stdin|--|-[a-z]|[A-Za-z/])' | head -30

  echo "== B: echo \"<prompt>\" | formal-ai with $t --model formalai/formal-ai --verbose"
  echo "$PROMPT" | PATH="$SHIM:$PATH" timeout 120 formal-ai with "$t" --model formalai/formal-ai --verbose \
    2>&1 >/dev/null | grep -E '^\s+(argv|stdin|--|-[a-z]|[A-Za-z/])' | head -30
done
