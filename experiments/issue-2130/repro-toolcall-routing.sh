#!/usr/bin/env bash
# Issue #2130 — Formal AI answers correctly with no tools declared, but emits an
# unrelated `date` shell call the moment the caller declares tools.
#
# Same server, same protocol, same sentence; the only variable is whether the
# request carries a `tools` block.
set -u
PORT="${PORT:-8133}"
PROMPT='Write a hello world program in Python.'
formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-tools-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/models" >/dev/null 2>&1 && break
  sleep 0.25
done

body() {
  node -e '
    const [prompt, withTools] = process.argv.slice(1);
    const req = { model: "formal-ai", messages: [{ role: "user", content: prompt }] };
    if (withTools === "yes") {
      req.tools = [
        { type: "function", function: { name: "run_shell_command", description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
        { type: "function", function: { name: "write_file", description: "Write a file", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } } },
      ];
    }
    process.stdout.write(JSON.stringify(req));
  ' "$1" "$2"
}

ask() {
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/chat/completions" \
    -H 'content-type: application/json' -H 'authorization: Bearer local' \
    -d "$(body "$PROMPT" "$1")" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).choices?.[0]?.message??{};
      console.log("tool_calls:", JSON.stringify(m.tool_calls ?? null));
      console.log("content:", JSON.stringify((m.content||"").slice(0,300)));});'
}

echo "== A: no tools declared"
ask no
echo
echo "== B: identical request + a tools block"
ask yes
