#!/usr/bin/env bash
# Issue #2130 — Formal AI reads only the FIRST part of a multi-part user turn.
#
# The gemini CLI sends contents[0].parts = [session_context, actual request].
# Formal AI acts on parts[0] only, so a context blob that mentions today's date
# routes the turn to run_shell_command("date") and the request is never seen.
#
# A = two parts (what the CLI sends)   B = one part, same bytes concatenated
set -u
PORT="${PORT:-8136}"
formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-parts-serve.log 2>&1 &
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
      const mode = process.argv[1];
      const context = "<session_context>\nThis is the Gemini CLI. We are setting up the context for our chat.\nToday'"'"'s date is Sunday, August 2, 2026 (formatted according to the user'"'"'s locale).\nMy operating system is: linux\n</session_context>";
      const request = "Write a hello world program in Python.";
      const parts = mode === "split" ? [{ text: context }, { text: request }] : [{ text: context + "\n" + request }];
      process.stdout.write(JSON.stringify({
        contents: [{ role: "user", parts }],
        tools: [{ functionDeclarations: [
          { name: "run_shell_command", description: "Run a shell command", parameters: { type: "OBJECT", properties: { command: { type: "STRING" } }, required: ["command"] } },
          { name: "write_file", description: "Write a file", parameters: { type: "OBJECT", properties: { file_path: { type: "STRING" }, content: { type: "STRING" } }, required: ["file_path", "content"] } },
        ] }],
      }));
    ' "$1")" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for (const p of (JSON.parse(s).candidates?.[0]?.content?.parts ?? [])) console.log("  " + JSON.stringify(p).slice(0, 200));});'
}

echo "== A: contents[0].parts = [context, request]   (what the gemini CLI sends)"
ask split
echo
echo "== B: contents[0].parts = [context + request]  (identical bytes, one part)"
ask joined
