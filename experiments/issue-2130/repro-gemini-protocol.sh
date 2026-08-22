#!/usr/bin/env bash
# Issue #2130 — is the "run `date` instead of the request" behaviour specific to
# Formal AI's Gemini protocol adapter?
#
# Same server, same sentence, three surfaces:
#   A. OpenAI chat/completions   (/api/openai/v1)
#   B. Anthropic messages        (/api/anthropic)
#   C. Gemini generateContent    (/api/gemini)
set -u
PORT="${PORT:-8132}"
PROMPT='Write a hello world program in Python.'
formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-proto-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/models" >/dev/null 2>&1 && break
  sleep 0.25
done

show() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.slice(0,1200)))'; }

echo "== A: OpenAI /api/openai/v1/chat/completions"
curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/chat/completions" \
  -H 'content-type: application/json' -H 'authorization: Bearer local' \
  -d "$(node -e 'process.stdout.write(JSON.stringify({model:"formal-ai",messages:[{role:"user",content:process.argv[1]}]}))' "$PROMPT")" | show
echo
echo "== B: Anthropic /api/anthropic/v1/messages"
curl -fsS "http://127.0.0.1:$PORT/api/anthropic/v1/messages" \
  -H 'content-type: application/json' -H 'x-api-key: local' -H 'anthropic-version: 2023-06-01' \
  -d "$(node -e 'process.stdout.write(JSON.stringify({model:"formal-ai",max_tokens:1024,messages:[{role:"user",content:process.argv[1]}]}))' "$PROMPT")" | show
echo
echo "== C: Gemini /api/gemini/v1beta/models/formal-ai:generateContent"
curl -fsS "http://127.0.0.1:$PORT/api/gemini/v1beta/models/formal-ai:generateContent" \
  -H 'content-type: application/json' -H 'x-goog-api-key: local' \
  -d "$(node -e 'process.stdout.write(JSON.stringify({contents:[{role:"user",parts:[{text:process.argv[1]}]}]}))' "$PROMPT")" | show
