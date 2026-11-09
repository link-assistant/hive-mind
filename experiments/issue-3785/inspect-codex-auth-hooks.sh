#!/usr/bin/env bash
# Inspect the real installed CLI's auth contract without auth or provider I/O.
set -euo pipefail
probe_root=$(mktemp -d /tmp/hive-3785-auth-hooks-XXXXXX)
probe_name="hive-3785-auth-hooks-$$"
probe_cli=${CODEX_PROBE_BINARY:-/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex}
cleanup() {
  docker rm -f "$probe_name" >/dev/null 2>&1 || true
  rm -rf "$probe_root"
}
trap cleanup EXIT
mkdir -p "$probe_root/schema"
docker run --rm --name "$probe_name" --cgroup-parent / --pids-limit 32 --network none \
  --user "$(id -u):$(id -g)" --ulimit data=536870912:536870912 \
  --mount "type=bind,source=$probe_cli,target=/usr/local/bin/codex,readonly" \
  --mount "type=bind,source=$probe_root,target=/probe" \
  -e HOME=/probe/home -e CODEX_HOME=/probe/home/.codex -e TOKIO_WORKER_THREADS=2 \
  alpine:3.22 sh -c 'mkdir -p "$HOME" "$CODEX_HOME"; codex --version; exec timeout 30 codex app-server generate-json-schema --out /probe/schema'
node --input-type=module - "$probe_root/schema/v2/LoginAccountParams.json" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const schema = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const external = schema.oneOf.find(item => item.properties?.type?.enum?.includes('chatgptAuthTokens'));
assert.ok(external, 'external ChatGPT-token mode must be found in this pinned schema');
assert.match(external.description, /UNSTABLE.*INTERNAL USE ONLY.*DO NOT USE/u);
console.log('OBSERVED: external ChatGPT-token login is marked internal and unstable in the installed CLI schema.');
console.log('No credentials, model requests or provider exchanges were used; this does not verify an execution adapter.');
JS
