#!/usr/bin/env bash
# Issue #2130 — does a large caller system prompt displace the user's request?
#
# The gemini CLI sends ~61k input tokens of framing; through it, "Write a hello
# world program in Python." makes Formal AI run `date`. With a bare request and a
# two-tool block, the same server writes main.py correctly. This sweeps the size
# of the caller's system prompt with everything else held constant.
set -u
PORT="${PORT:-8134}"
PROMPT='Write a hello world program in Python.'
formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-sys-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/models" >/dev/null 2>&1 && break
  sleep 0.25
done

probe() {
  local repeats="$1"
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/chat/completions" \
    -H 'content-type: application/json' -H 'authorization: Bearer local' \
    -d "$(node -e '
      const [prompt, repeats] = process.argv.slice(1);
      const unit = "You are an interactive CLI agent specializing in software engineering tasks. Your primary goal is to help users safely and efficiently, adhering strictly to the following instructions and utilizing your available tools. Always use absolute paths. Never assume a library is available. Explain critical commands before running them. Do not revert changes unless asked.\n";
      const messages = [];
      if (Number(repeats) > 0) messages.push({ role: "system", content: unit.repeat(Number(repeats)) });
      messages.push({ role: "user", content: prompt });
      const req = { model: "formal-ai", messages, tools: [
        { type: "function", function: { name: "run_shell_command", description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
        { type: "function", function: { name: "write_file", description: "Write a file", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } } },
      ] };
      process.stdout.write(JSON.stringify(req));
    ' "$PROMPT" "$repeats")" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const m=j.choices?.[0]?.message??{};
      const c=(m.tool_calls??[]).map(t=>`${t.function.name}(${t.function.arguments.slice(0,80)})`).join(", ");
      console.log(`  prompt_tokens=${j.usage?.prompt_tokens} tool_calls=${c||"none"}`);});'
}

for repeats in 0 1 20 200 1000; do
  echo "== system prompt x$repeats"
  probe "$repeats"
done
