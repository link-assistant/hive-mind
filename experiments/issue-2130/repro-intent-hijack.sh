#!/usr/bin/env bash
# Issue #2130 — Formal AI's intent router matches the CALLER'S framing, not the
# user's request, and a declarative sentence is treated as if it were a question.
#
# The gemini CLI prefixes every turn with a <session_context> block containing
# "Today's date is <date> (formatted according to the user's locale)." In agent
# mode with tools declared, Formal AI answers *that sentence* — it calls
# run_shell_command("date") — and never acts on the request that follows.
# Because the CLI always injects the line, every gemini run is hijacked.
#
# Held constant: server, protocol, tool declarations, the request. The only
# variable is one line of caller context.
set -u
PORT="${PORT:-8138}"
REQUEST='Write a hello world program in Python.'

formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-intent-hijack.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/models" >/dev/null 2>&1 && break
  sleep 0.25
done

ask() {
  printf '  %-52s -> ' "$(printf '%s' "$1" | head -c 50)"
  curl -fsS "http://127.0.0.1:$PORT/api/gemini/v1beta/models/formal-ai:generateContent" \
    -H 'content-type: application/json' -H 'x-goog-api-key: local' \
    -d "$(node -e '
      const [context, request] = process.argv.slice(1);
      process.stdout.write(JSON.stringify({
        contents: [{ role: "user", parts: [{ text: context }, { text: request }] }],
        tools: [{ functionDeclarations: [
          { name: "run_shell_command", description: "Run a shell command", parameters: { type: "OBJECT", properties: { command: { type: "STRING" } }, required: ["command"] } },
          { name: "write_file", description: "Write a file", parameters: { type: "OBJECT", properties: { file_path: { type: "STRING" }, content: { type: "STRING" } }, required: ["file_path", "content"] } },
        ] }],
      }));
    ' "$1" "$REQUEST")" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const parts = JSON.parse(s).candidates?.[0]?.content?.parts ?? [];
      const call = parts.find(p => p.functionCall)?.functionCall;
      console.log(call ? `${call.name}(${JSON.stringify(call.args).slice(0, 60)})` : "text-only");});'
}

echo "== the session_context the gemini CLI really sends"
ask "<session_context>
This is the Gemini CLI. We are setting up the context for our chat.
Today's date is Sunday, August 2, 2026 (formatted according to the user's locale).
My operating system is: linux
</session_context>"

echo
echo "== the same context with only the date sentence removed"
ask "<session_context>
This is the Gemini CLI. We are setting up the context for our chat.
My operating system is: linux
</session_context>"

echo
echo "== narrowing the trigger to a phrase"
ask "Today's date is Sunday, August 2, 2026."
ask "The current time is 20:00."
ask "The date is Sunday."
ask "Today is Sunday, August 2, 2026."
ask "date"
ask "My operating system is: linux"
ask ""
