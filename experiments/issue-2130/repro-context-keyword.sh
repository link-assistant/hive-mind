#!/usr/bin/env bash
# Issue #2130 — Formal AI's intent router matches keywords in the CALLER'S
# framing, not in the user's request.
#
# The gemini CLI's session_context contains "Today's date is Sunday, August 2,
# 2026". With tools declared, Formal AI answers that sentence — run_shell_command
# ("date") — and never acts on the request that follows it.
#
# Held constant: server, protocol, tools, the request. Variable: one line of context.
set -u
PORT="${PORT:-8137}"
formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-kw-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/models" >/dev/null 2>&1 && break
  sleep 0.25
done

ask() {
  curl -fsS "http://127.0.0.1:$PORT/api/gemini/v1beta/models/formal-ai:generateContent" \
    -H 'content-type: application/json' -H 'x-goog-api-key: local' \
    -d "$(node -e '
      process.stdout.write(JSON.stringify({
        contents: [{ role: "user", parts: [{ text: process.argv[1] }, { text: "Write a hello world program in Python." }] }],
        tools: [{ functionDeclarations: [
          { name: "run_shell_command", description: "Run a shell command", parameters: { type: "OBJECT", properties: { command: { type: "STRING" } }, required: ["command"] } },
          { name: "write_file", description: "Write a file", parameters: { type: "OBJECT", properties: { file_path: { type: "STRING" }, content: { type: "STRING" } }, required: ["file_path", "content"] } },
        ] }],
      }));
    ' "$1")" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for (const p of (JSON.parse(s).candidates?.[0]?.content?.parts ?? [])) console.log("  " + JSON.stringify(p).slice(0, 170));});'
}

echo "== A: context contains the date sentence"
ask "<session_context>
This is the Gemini CLI. We are setting up the context for our chat.
Today's date is Sunday, August 2, 2026 (formatted according to the user's locale).
My operating system is: linux
</session_context>"
echo
echo "== B: same context, date sentence removed"
ask "<session_context>
This is the Gemini CLI. We are setting up the context for our chat.
My operating system is: linux
</session_context>"
echo
echo "== C: no context at all"
ask ""
