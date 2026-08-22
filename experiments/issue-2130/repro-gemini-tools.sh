#!/usr/bin/env bash
# Issue #2130 — Formal AI's Gemini protocol adapter ignores the request once the
# caller declares tools, and calls run_shell_command("date") instead.
#
# Held constant: server, agent mode, model, the sentence. The only variable is
# the protocol the identical tools-bearing request is sent over.
set -u
PORT="${PORT:-8135}"
PROMPT='Write a hello world program in Python.'
formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-gt-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/models" >/dev/null 2>&1 && break
  sleep 0.25
done

echo "== A: Gemini protocol, tools declared"
curl -fsS "http://127.0.0.1:$PORT/api/gemini/v1beta/models/formal-ai:generateContent" \
  -H 'content-type: application/json' -H 'x-goog-api-key: local' \
  -d "$(node -e '
    process.stdout.write(JSON.stringify({
      contents: [{ role: "user", parts: [{ text: process.argv[1] }] }],
      tools: [{ functionDeclarations: [
        { name: "run_shell_command", description: "Run a shell command", parameters: { type: "OBJECT", properties: { command: { type: "STRING" } }, required: ["command"] } },
        { name: "write_file", description: "Write a file", parameters: { type: "OBJECT", properties: { file_path: { type: "STRING" }, content: { type: "STRING" } }, required: ["file_path", "content"] } },
      ] }],
    }));
  ' "$PROMPT")" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).candidates?.[0]?.content?.parts??[];
    for (const part of p) console.log("  " + JSON.stringify(part).slice(0, 220));});'

echo
echo "== B: OpenAI protocol, same tools (control)"
curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/chat/completions" \
  -H 'content-type: application/json' -H 'authorization: Bearer local' \
  -d "$(node -e '
    process.stdout.write(JSON.stringify({ model: "formal-ai", messages: [{ role: "user", content: process.argv[1] }], tools: [
      { type: "function", function: { name: "run_shell_command", description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
      { type: "function", function: { name: "write_file", description: "Write a file", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } } },
    ] }));
  ' "$PROMPT")" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).choices?.[0]?.message??{};
    console.log("  " + JSON.stringify(m.tool_calls ?? m.content).slice(0, 220));});'
