#!/usr/bin/env bash
# Issue #2888: where does qwen-code keep the sessions that `--resume <id>` reads,
# and can a session be resumed from a different cwd (fresh clone of the same repo)?
# No credentials needed: an OpenAI-compatible endpoint on a closed port is used, so
# the model call fails, but the session file is written and the *lookup* is observable.
set -u
S=${S:-/tmp/s-qw-exp}
rm -rf "$S"; mkdir -p "$S/home" "$S/a"
(cd "$S/a" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init)
git clone -q "$S/a" "$S/b"
export HOME="$S/home"
unset QWEN_HOME QWEN_RUNTIME_DIR
Q() { timeout -s KILL 90 qwen --auth-type openai --openai-api-key fake --openai-base-url http://127.0.0.1:9/v1 --model fake-model --output-format stream-json --yolo "$@" 2>&1 | grep -v "^Warning: running headless" | grep -o '"subtype":"[^"]*"\|"session_id":"[^"]*"\|"cwd":"[^"]*"\|"result":"[^"]\{0,160\}\|^[^{].\{0,240\}' | sort -u; }

echo "== qwen --version: $(timeout 30 qwen --version 2>&1 | tail -1)"
echo "== 1. new session in original cwd $S/a"
OUT=$(cd "$S/a" && Q --prompt hello); echo "$OUT"
ID=$(echo "$OUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "== files under ~/.qwen/projects"; find "$S/home/.qwen/projects" | sort

echo "== 2. --resume $ID from original cwd $S/a"; (cd "$S/a" && Q --resume "$ID" --prompt again)
echo "== 3. --resume $ID from clone $S/b (same repo, same root commit)"; (cd "$S/b" && Q --resume "$ID" --prompt again)
echo "== 4. --resume unknown id from $S/a"; (cd "$S/a" && Q --resume 99999999-0000-4000-8000-000000000000 --prompt again)
echo "== 5. --resume $ID with a fresh HOME (= fresh container without ~/.qwen)"
mkdir -p "$S/home-fresh"; (cd "$S/a" && HOME="$S/home-fresh" Q --resume "$ID" --prompt again)
echo "== 6. QWEN_HOME / QWEN_RUNTIME_DIR relocate the projects dir"
(cd "$S/a" && QWEN_HOME="$S/qwen-home" Q --prompt hello >/dev/null); find "$S/qwen-home/projects" -name '*.jsonl' | sed "s|$S|\$S|"
(cd "$S/a" && QWEN_RUNTIME_DIR="$S/qwen-runtime" Q --prompt hello >/dev/null); find "$S/qwen-runtime" -name '*.jsonl' | sed "s|$S|\$S|"
echo "== 7. copying the session file alone into b's sanitized-cwd dir (does it suffice?)"
mkdir -p "$S/home/.qwen/projects/$(echo "$S/b" | sed 's/[^a-zA-Z0-9]/-/g')/chats"
cp "$S/home/.qwen/projects/$(echo "$S/a" | sed 's/[^a-zA-Z0-9]/-/g')/chats/$ID.jsonl" "$S/home/.qwen/projects/$(echo "$S/b" | sed 's/[^a-zA-Z0-9]/-/g')/chats/"
(cd "$S/b" && Q --resume "$ID" --prompt again)
echo "== 8. cwd recorded inside the session file"; head -1 "$S/home/.qwen/projects/-tmp-s-qw-exp-a/chats/$ID.jsonl" | grep -o '"cwd":"[^"]*"'
echo "== 9. copy + rewrite the recorded \"cwd\" to $S/b (first record is checked by sessionBelongsToCurrentProject) -> resume from b"
BF="$S/home/.qwen/projects/$(echo "$S/b" | sed 's/[^a-zA-Z0-9]/-/g')/chats/$ID.jsonl"
sed -i "s|\"cwd\":\"$S/a\"|\"cwd\":\"$S/b\"|g" "$BF"
(cd "$S/b" && Q --resume "$ID" --prompt again)
