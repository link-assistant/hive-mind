#!/usr/bin/env bash
# Issue #2888: where does gemini-cli keep the sessions that `--resume <id>` reads,
# and can a session be resumed from a different cwd (fresh clone of the same repo)?
# No credentials needed: a fake GEMINI_API_KEY is used, so the API call fails, but
# session *lookup* happens before the API call and is what we observe.
set -u
S=${S:-/tmp/s-gm-exp}
rm -rf "$S"; mkdir -p "$S/home" "$S/a"
(cd "$S/a" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init)
git clone -q "$S/a" "$S/b"
export HOME="$S/home" GEMINI_API_KEY=fake-key-for-test
unset GEMINI_CLI_HOME XDG_DATA_HOME
G() { timeout 90 gemini "$@" 2>&1 | grep -v "256-color\|YOLO mode\|Ripgrep" | cut -c1-260 | head -6; }

echo "== gemini --version: $(timeout 30 gemini --version 2>&1 | tail -1)"
echo "== 1. run once in $S/a (fake key -> API error, but storage gets initialised)"
(cd "$S/a" && G --output-format stream-json --model gemini-2.5-flash --approval-mode yolo --skip-trust -p hello)
echo "== files under HOME after run"; find "$S/home" -type f | sort
echo "== projects.json"; cat "$S/home/.gemini/projects.json"; echo

# The failed turn leaves no resumable content (and gemini deletes such files), so
# write a minimal resumable session in the exact on-disk format gemini 0.63 uses.
ID=11111111-2222-4333-8444-555555555555
CH="$S/home/.gemini/tmp/a/chats"; mkdir -p "$CH"
cat > "$CH/session-2026-10-10T00-00-11111111.jsonl" <<EOF
{"sessionId":"$ID","projectHash":"x","startTime":"2026-10-10T00:00:00.000Z","lastUpdated":"2026-10-10T00:00:01.000Z","kind":"main"}
{"id":"m1","timestamp":"2026-10-10T00:00:00.500Z","type":"user","content":[{"text":"hello"}]}
{"id":"m2","timestamp":"2026-10-10T00:00:01.000Z","type":"gemini","content":"hi there"}
EOF
echo "== 2. --list-sessions from original cwd $S/a"; (cd "$S/a" && G --list-sessions)
echo "== 3. --list-sessions from clone $S/b (same repo, same root commit)"; (cd "$S/b" && G --list-sessions)
echo "== 4. --resume $ID from original cwd $S/a"; (cd "$S/a" && G --output-format stream-json --model gemini-2.5-flash --approval-mode yolo --skip-trust --resume "$ID" -p again)
echo "== 5. --resume $ID from clone $S/b"; (cd "$S/b" && G --output-format stream-json --model gemini-2.5-flash --approval-mode yolo --skip-trust --resume "$ID" -p again)
echo "== 6. --resume unknown id from $S/a"; (cd "$S/a" && G --output-format stream-json --model gemini-2.5-flash --approval-mode yolo --skip-trust --resume 99999999-0000-4000-8000-000000000000 -p again)
echo "== 7. projects.json after visiting b"; cat "$S/home/.gemini/projects.json"; echo
echo "== 8. GEMINI_CLI_HOME relocates storage (fresh dir, run --list-sessions from a)"
mkdir -p "$S/alt"; (cd "$S/a" && GEMINI_CLI_HOME="$S/alt" G --list-sessions); find "$S/alt" -maxdepth 3 | sort
echo "== 9. copying the original session dir into b's slug makes resume from b work"
mkdir -p "$S/home/.gemini/tmp/b/chats"; cp "$CH"/*.jsonl "$S/home/.gemini/tmp/b/chats/"
(cd "$S/b" && G --output-format stream-json --model gemini-2.5-flash --approval-mode yolo --skip-trust --resume "$ID" -p again)
