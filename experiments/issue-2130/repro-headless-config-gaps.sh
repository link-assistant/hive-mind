#!/usr/bin/env bash
# Issue #2130 — `formal-ai with <tool> --global` writes an incomplete headless
# configuration for gemini and qwen: both CLIs refuse to start non-interactively
# because the setting they need to select an auth type is never written.
#
# For each tool: A = exactly what --global writes, B = A plus the missing piece.
set -u
PORT="${PORT:-8080}"

formal-ai serve --agent-mode --host 127.0.0.1 --port "$PORT" >/tmp/fa-headless-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/openai/v1/models" >/dev/null 2>&1 && break
  sleep 0.25
done

# Show the configuration --global actually produces, into a throwaway HOME so the
# operator's real profile is never touched.
show_global() {
  local tool="$1" home
  home="$(mktemp -d /tmp/fa-global-home-XXXXXX)"
  HOME="$home" timeout 120 formal-ai with "$tool" --global >/dev/null 2>&1
  echo "  --- what \`formal-ai with $tool --global\` writes to ~/.profile"
  sed 's/^/      /' "$home/.profile"
  rm -rf "$home"
}

# Report only whether the CLI got far enough to talk to the model: the refusal
# messages are the finding, anything after them is noise.
verdict() {
  local out="$1"
  local refusal
  refusal="$(printf '%s' "$out" | grep -m1 -E 'Invalid auth method selected|No auth type is selected')"
  if [ -n "$refusal" ]; then echo "      REFUSED TO START: $refusal"; else echo "      started: reached the model"; fi
}

run_tool() {
  local tool="$1" home="$2"; shift 2
  local ws; ws="$(mktemp -d /tmp/fa-headless-ws-XXXXXX)"
  local vars=("HOME=$home" "$@")
  local out
  case "$tool" in
    gemini) out="$(cd "$ws" && env "${vars[@]}" timeout 90 gemini --model formal-ai --approval-mode yolo --skip-trust -p 'Reply with the single word: ok' </dev/null 2>&1)" ;;
    qwen) out="$(cd "$ws" && env "${vars[@]}" timeout 90 qwen --yolo --model formal-ai -p 'Reply with the single word: ok' </dev/null 2>&1)" ;;
  esac
  verdict "$out"
  rm -rf "$ws"
}

echo "########## gemini"
show_global gemini
GEM_BASE=(GEMINI_API_KEY=formal-ai GEMINI_DEFAULT_AUTH_TYPE=gemini-api-key GEMINI_CLI_TRUST_WORKSPACE=true "GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:$PORT/api/gemini")
echo "  A: environment only (what --global writes)"
run_tool gemini "$(mktemp -d /tmp/fa-headless-home-XXXXXX)" "${GEM_BASE[@]}"
HOME_B="$(mktemp -d /tmp/fa-headless-home-XXXXXX)"
mkdir -p "$HOME_B/.gemini"
printf '{ "security": { "auth": { "selectedType": "gemini-api-key" } } }\n' >"$HOME_B/.gemini/settings.json"
echo "  B: same environment + settings.json security.auth.selectedType"
run_tool gemini "$HOME_B" "${GEM_BASE[@]}" "GEMINI_CLI_SYSTEM_SETTINGS_PATH=$HOME_B/.gemini/settings.json"

echo
echo "########## qwen"
show_global qwen
QWEN_BASE=(OPENAI_API_KEY=formal-ai "OPENAI_BASE_URL=http://127.0.0.1:$PORT/api/openai/v1")
echo "  A: environment only (what --global writes)"
run_tool qwen "$(mktemp -d /tmp/fa-headless-home-XXXXXX)" "${QWEN_BASE[@]}"
echo "  B: same environment + OPENAI_MODEL"
run_tool qwen "$(mktemp -d /tmp/fa-headless-home-XXXXXX)" "${QWEN_BASE[@]}" OPENAI_MODEL=formal-ai
