#!/usr/bin/env bash
# Issue #2130 — does a CLI-injected session preamble change Formal AI's routing?
#
# The gemini CLI prepends "<session_context>…</session_context>" to the user turn.
# Through gemini, "Write a hello world program in Python." makes Formal AI run
# `date`; probed directly the same sentence produces Python. This isolates the
# preamble as the variable: same server, same sentence, with and without it.
set -u
PORT="${PORT:-8131}"
formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-preamble-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/models" >/dev/null 2>&1 && break
  sleep 0.25
done

ask() {
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/chat/completions" \
    -H 'content-type: application/json' -H 'authorization: Bearer local' \
    -d "$(node -e 'process.stdout.write(JSON.stringify({model:"formal-ai",messages:[{role:"user",content:process.argv[1]}]}))' "$1")" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify(j.choices?.[0]?.message?.content??j));})'
}

PLAIN='Write a hello world program in Python.'
PREAMBLE='<session_context>
This is the Gemini CLI. We are setting up the context for our chat.
Today'"'"'s date is Sunday, August 2, 2026 (formatted according to the user'"'"'s locale).
My operating system is: linux
</session_context>
Write a hello world program in Python.'

echo "== A: bare sentence"
ask "$PLAIN"
echo
echo "== B: same sentence behind a gemini-style session preamble"
ask "$PREAMBLE"
