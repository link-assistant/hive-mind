#!/usr/bin/env bash
# Real CLI, two processes sharing one auth directory, disposable local provider.
# Reproduces the uncoordinated exchange; this is not a production integration gate.
set -euo pipefail
probe_root=$(mktemp -d /tmp/hive-3785-refresh-XXXXXX)
probe_name="hive-3785-refresh-$$"
probe_cli=${CODEX_PROBE_BINARY:-/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex}
cleanup() {
  docker rm -f "$probe_name" >/dev/null 2>&1 || true
  rm -rf "$probe_root"
}
trap cleanup EXIT
mkdir -p "$probe_root/state"
cp experiments/issue-3785/refresh-stub-handler.sh "$probe_root/handler.sh"
chmod +x "$probe_root/handler.sh"
node --input-type=module - "$probe_root" <<'JS'
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const jwt = payload => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.synthetic`;
const idToken = jwt({ sub: 'synthetic-user', 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_user_id: 'synthetic-user', chatgpt_plan_type: 'pro' } });
const tokens = { id_token: idToken, access_token: jwt({ exp: 1 }), refresh_token: 'synthetic-refresh-g0', account_id: 'synthetic-account' };
writeFileSync(path.join(root, 'state', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens, last_refresh: '2020-01-01T00:00:00Z' }), { mode: 0o600 });
writeFileSync(path.join(root, 'refresh-response.json'), JSON.stringify({ access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), refresh_token: 'synthetic-refresh-g1', token_type: 'Bearer', expires_in: 3600 }));
JS
docker run -d --name "$probe_name" --cgroup-parent / --pids-limit 96 --network none \
  --user "$(id -u):$(id -g)" --ulimit data=536870912:536870912 \
  --mount "type=bind,source=$probe_cli,target=/usr/local/bin/codex,readonly" \
  --mount "type=bind,source=$probe_root,target=/probe" \
  -e HOME=/tmp/home -e CODEX_HOME=/probe/state \
  -e CODEX_REFRESH_TOKEN_URL_OVERRIDE=http://127.0.0.1:18485/oauth/token \
  alpine:3.22 sh -c 'mkdir -p "$HOME" /tmp/project; exec nc -lk -p 18485 -e /probe/handler.sh' >/dev/null
docker exec "$probe_name" codex --version
probe_args=(exec --skip-git-repo-check --ephemeral -C /tmp/project -m synthetic-model
  -c 'model_provider="offline"' -c 'model_providers.offline.name="Offline"'
  -c 'model_providers.offline.base_url="http://127.0.0.1:18485/v1"'
  -c 'model_providers.offline.wire_api="responses"' -c 'model_providers.offline.requires_openai_auth=true'
  -c 'model_providers.offline.request_max_retries=0' -c 'model_providers.offline.stream_max_retries=0'
  -c 'features.remote_plugin=false' 'Do not invoke tools. Exit.')
# Finite probe deadlines bound unexpected CLI retry/hang behavior. No external
# network or real credential paths are available to either process.
docker exec "$probe_name" timeout 60 codex "${probe_args[@]}" > "$probe_root/a.log" 2>&1 &
probe_a=$!
docker exec "$probe_name" timeout 60 codex "${probe_args[@]}" > "$probe_root/b.log" 2>&1 &
probe_b=$!
probe_status_a=0
probe_status_b=0
wait "$probe_a" || probe_status_a=$?
wait "$probe_b" || probe_status_b=$?
cat "$probe_root/a.log" "$probe_root/b.log" > /tmp/issue-3785-refresh-cli-debug.log
if [ "$probe_status_a" -eq 124 ] || [ "$probe_status_b" -eq 124 ]; then
  echo 'Probe did not complete before its finite deadline.' >&2
  exit 1
fi
if [ ! -f "$probe_root/events" ] || [ "$(wc -l < "$probe_root/events")" -ne 2 ] || [ "$(grep -c '^refresh-accepted$' "$probe_root/events")" -ne 1 ] || [ "$(grep -c '^refresh-reused$' "$probe_root/events")" -ne 1 ]; then
  echo 'Expected overlapping refresh exchange was not established; inspect the local synthetic CLI debug log.' >&2
  exit 1
fi
node --input-type=module - "$probe_root/state/auth.json" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const stored = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.ok(stored.tokens.refresh_token === 'synthetic-refresh-g1', 'one canonical replacement must be committed');
JS
printf 'REPRODUCED: two real Codex processes submitted the same predecessor before commit.\n'
printf 'Provider accepted one exchange and rejected consumed-token reuse by the other.\n'
printf 'Both processes shared a directory-mounted auth store; no scoped credential copies were involved.\n'
