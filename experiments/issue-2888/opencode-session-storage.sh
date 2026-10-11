#!/usr/bin/env bash
# Issue #2888: where does opencode keep the sessions that `run --session <id>` reads,
# and what happens when the session is resumed from a different cwd (fresh clone of
# the same repo), with and without the original directory, and from a fresh HOME?
# Uses the credential-free `opencode/big-pickle` model (network required) so that the
# bash tool really runs and reports its cwd. Every call is bounded with SIGKILL
# because `opencode run` sometimes ignores SIGTERM after the loop has finished.
set -u
S=${S:-/tmp/s-oc-exp}
MODEL=${MODEL:-opencode/big-pickle}
rm -rf "$S"; mkdir -p "$S/home" "$S/a"
(cd "$S/a" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init)
git clone -q "$S/a" "$S/b"
export HOME="$S/home"
unset XDG_DATA_HOME OPENCODE_DB
OC() { timeout -s KILL 90 opencode "$@" 2>&1; }
PWDQ="Use the bash tool to run: pwd. Then reply with only its output."
pick() { grep -o '"sessionID":"[^"]*"\|"output":"[^"]*"\|"text":"[^"]*"\|"error".\{0,220\}\|Error: .*' | sort -u; }

echo "== opencode --version: $(OC --version | tail -1)"
echo "== opencode debug paths"; OC debug paths
echo "== opencode db path"; OC db path
echo "== root commit of a: $(git -C "$S/a" rev-list --max-parents=0 HEAD)"

echo "== 1. new session in original cwd $S/a"
OUT=$(cd "$S/a" && OC run --auto --format json --model "$MODEL" "$PWDQ"); echo "$OUT" | pick
ID=$(echo "$OUT" | grep -o '"sessionID":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "== session rows"; OC db "select id, project_id, directory from session"
echo "== files"; find "$S/home/.local/share/opencode" -maxdepth 1 | sort

echo "== 2. resume $ID from clone $S/b (original $S/a still exists) -> where does bash run?"
(cd "$S/b" && OC run --auto --format json --session "$ID" --model "$MODEL" "$PWDQ" > "$S/step2.out"); pick < "$S/step2.out"
echo "-- bash tool outputs recorded in the DB for this session (1st = step 1 from a, 2nd = step 2 from b):"
OC db "select json_extract(p.data,'\$.state.output') from part p join message m on m.id=p.message_id where m.session_id='$ID' and json_extract(p.data,'\$.tool')='bash' order by p.id"

echo "== 3. resume unknown id from $S/b"
(cd "$S/b" && OC run --format json --session ses_doesnotexist000000000000 --model "$MODEL" "$PWDQ") | pick

echo "== 4. resume $ID with a fresh HOME (= fresh container without ~/.local/share/opencode)"
mkdir -p "$S/home-fresh"; (cd "$S/b" && HOME="$S/home-fresh" OC run --format json --session "$ID" --model "$MODEL" "$PWDQ") | pick

echo "== 5. resume $ID from $S/b after removing the original directory $S/a"
mv "$S/a" "$S/a.removed"
(cd "$S/b" && OC run --auto --format json --session "$ID" --model "$MODEL" "$PWDQ") | pick
echo "-- instances opencode created during the runs (log):"
grep -o 'message="creating instance" directory=[^ ]*' "$S/home/.local/share/opencode/log/opencode.log"

echo "== 6. --dir $S/b does not override the stored session directory"
(cd "$S/b" && OC run --auto --format json --dir "$S/b" --session "$ID" --model "$MODEL" "$PWDQ") | pick
grep -o 'message="creating instance" directory=[^ ]*' "$S/home/.local/share/opencode/log/opencode.log" | tail -2

echo "== 7. rewrite session.directory to $S/b, then resume from $S/b"
OC db "update session set directory='$S/b' where id='$ID'"
(cd "$S/b" && OC run --auto --format json --session "$ID" --model "$MODEL" "$PWDQ") | pick

echo "== 8. export -> import into a fresh HOME from another cwd: import re-homes the session to the importing cwd/project"
timeout -s KILL 90 opencode export "$ID" 2>/dev/null | sed -n "/^{/,\$p" > "$S/export.json"; mkdir -p "$S/home-import" "$S/c"
echo "-- exported directory/projectID:"; grep -o '"directory": *"[^"]*"\|"projectID": *"[^"]*"' "$S/export.json" | sort -u
(cd "$S/c" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m other)
echo "-- root commit of unrelated repo c: $(git -C "$S/c" rev-list --max-parents=0 HEAD)"
(cd "$S/c" && HOME="$S/home-import" OC import "$S/export.json" | tail -1)
HOME="$S/home-import" OC db "select id, project_id, directory from session"

echo "== 9. OPENCODE_DB / XDG_DATA_HOME relocation"
HOME="$S/home" OPENCODE_DB=/tmp/custom-oc.db OC db path
HOME="$S/home" XDG_DATA_HOME="$S/xdg" OC db path
