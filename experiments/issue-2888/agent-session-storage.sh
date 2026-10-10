#!/usr/bin/env bash
# Issue #2888: where does @link-assistant/agent keep the sessions that
# `agent --resume <id> --no-fork` reads (src/agent-command.lib.mjs:59), and can a
# session be resumed from a different cwd (fresh clone of the same repo), from a
# fresh HOME (= fresh container), and after the original worktree is removed?
# Uses the credential-free `opencode/big-pickle` model (network required) so that the
# bash tool really runs and reports its cwd. Every call is bounded with SIGKILL.
set -u
S=${S:-/tmp/s-ag-exp}
MODEL=${MODEL:-opencode/big-pickle}
rm -rf "$S"; mkdir -p "$S/home" "$S/a"
(cd "$S/a" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init)
git clone -q "$S/a" "$S/b"
export HOME="$S/home"
unset XDG_DATA_HOME
D="$S/home/.local/share/link-assistant-agent"
PWDQ="Use the bash tool to run: pwd. Then reply with only its output."
AG() { timeout -s KILL 90 agent --model "$MODEL" --disable-stdin --no-always-accept-stdin --compact-json --prompt "$PWDQ" "$@" 2>&1; }
pick() { grep -o '"sessionID":"[^"]*"\|"output":"[^"]\{0,120\}"\|"errorType":"[^"]*"\|"error":"[^"]\{0,200\}\|"message":"[^"]*[Ss]ession[^"]\{0,160\}"\|Session not found[^"]\{0,120\}' | sort -u; }
outs() { grep -rho '"output": *"[^"]*"' "$1/storage/part" 2>/dev/null | sort | uniq -c; }

echo "== agent --version: $(timeout 30 agent --version 2>&1 | tail -1)"
echo "== root commit of a: $(git -C "$S/a" rev-list --max-parents=0 HEAD)"

echo "== 1. new session in original cwd $S/a"
OUT=$(cd "$S/a" && AG); echo "$OUT" | pick | head -8
ID=$(echo "$OUT" | grep -o '"sessionID":"ses_[^"]*"' | head -1 | cut -d'"' -f4)
echo "== storage tree (depth 3)"; find "$D/storage" -maxdepth 3 | sed "s|$S|\$S|" | sort
echo "== session record"; cat "$D"/storage/session/*/"$ID".json; echo
echo "== project record"; cat "$D"/storage/project/*.json; echo
echo "== .git/opencode cache in a: $(cat "$S/a/.git/opencode" 2>/dev/null)"

echo "== 2. --resume $ID --no-fork from clone $S/b (same root commit; original a still exists)"
(cd "$S/b" && AG --resume "$ID" --no-fork) | pick | head -8
echo "-- bash outputs stored for all sessions (count  output):"; outs "$D"
echo "-- sessions now on disk:"; find "$D/storage/session" -name '*.json' | sed "s|$S|\$S|"

echo "== 3. --resume unknown id from $S/b"
(cd "$S/b" && AG --resume ses_doesnotexist000000000000 --no-fork) | pick | head -5

echo "== 4. --resume $ID with a fresh HOME (= fresh container without ~/.local/share/link-assistant-agent)"
mkdir -p "$S/home-fresh"; (cd "$S/b" && HOME="$S/home-fresh" AG --resume "$ID" --no-fork) | pick | head -5

echo "== 5. --resume $ID from an unrelated repo (different root commit)"
mkdir -p "$S/c"; (cd "$S/c" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m other)
(cd "$S/c" && AG --resume "$ID" --no-fork) | pick | head -5

echo "== 6. XDG_DATA_HOME relocates the data dir"
(cd "$S/a" && XDG_DATA_HOME="$S/xdg" AG >/dev/null); find "$S/xdg" -maxdepth 4 -path '*storage/session*' | sed "s|$S|\$S|"

echo "== 7. copying the data dir into a fresh HOME makes resume from b work"
mkdir -p "$S/home-copy/.local/share"; cp -a "$D" "$S/home-copy/.local/share/"
(cd "$S/b" && HOME="$S/home-copy" AG --resume "$ID" --no-fork) | pick | head -5
