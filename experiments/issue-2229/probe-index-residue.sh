#!/bin/sh
# Issue #2229, round 4: two leftovers from round 3.
#
#  (a) A pathspec commit builds a temporary index (GIT_INDEX_FILE), so the
#      evidence the hook stages never reaches the real index - `git status` is
#      then dirty and the NEXT commit would delete the evidence again.  Does
#      adding to the real index as well clean that up, for every commit form?
#  (b) With the hook staging evidence, does a `git commit` that has nothing else
#      staged turn into an evidence-only commit?  It should not: evidence is
#      supposed to ride along with a change, not manufacture one.
set -u

work="$(mktemp -d)"; stage="$work/stage"; mkdir -p "$stage"
printf 'formal-ai session ses_probe\nformal-ai model formal-ai/0.345.0\n' > "$stage/session-id.txt"
repo="$work/repo"; mkdir -p "$repo"
git -C "$repo" init --quiet
git -C "$repo" config user.email probe@example.com
git -C "$repo" config user.name Probe

cat > "$repo/.git/hooks/pre-commit" <<EOF
#!/bin/sh
set -e
dir="dev/log/self-authored/issue-2229/evidence"
[ -e "\$(git rev-parse --git-path MERGE_HEAD)" ] && exit 0
# nothing else staged => this commit is not a change worth attributing
if [ -z "\$(git diff --cached --name-only -- . ':(exclude)'"\$dir" 2>/dev/null)" ]; then
  echo "hive-mind: no change staged, evidence not attached" >&2
  exit 0
fi
mkdir -p "\$dir"
cp "$stage/session-id.txt" "\$dir/session-id.txt"
git add -f -- "\$dir"
# a pathspec/-a commit stages into a temporary index; keep the real one in sync
if [ -n "\${GIT_INDEX_FILE:-}" ]; then
  ( unset GIT_INDEX_FILE; git add -f -- "\$dir" )
fi
EOF
cat > "$repo/.git/hooks/prepare-commit-msg" <<'EOF'
#!/bin/sh
set -e
dir="dev/log/self-authored/issue-2229/evidence"
[ -e "$(git rev-parse --git-path MERGE_HEAD)" ] && exit 0
case "$(git cat-file blob ":$dir/session-id.txt" 2>/dev/null || true)" in
  *ses_probe*) ;;
  *) exit 0 ;;
esac
git interpret-trailers --in-place --if-exists replace \
  --trailer "Formal-AI-Session: ses_probe" \
  --trailer "Formal-AI-Evidence: $dir" "$1"
EOF
chmod +x "$repo/.git/hooks/pre-commit" "$repo/.git/hooks/prepare-commit-msg"

report() {
  sha="$(git -C "$repo" rev-parse HEAD)"
  if git -C "$repo" show "$sha:dev/log/self-authored/issue-2229/evidence/session-id.txt" >/dev/null 2>&1; then evidence=IN-TREE; else evidence=MISSING; fi
  t="$(git -C "$repo" log -1 --format=%B "$sha" | git interpret-trailers --parse | grep -c '^Formal-AI-' || true)"
  printf '%-30s subject=%-12s evidence=%-8s trailers=%s status=[%s]\n' "$1" "$(git -C "$repo" log -1 --format=%s)" "$evidence" "$t" "$(git -C "$repo" status --porcelain | tr '\n' ' ')"
}

cd "$repo"
echo one > a.txt; git add a.txt; git commit --quiet -m plain; report "git commit -m"
echo two >> a.txt; git commit --quiet -a -m dash-a; report "git commit -a -m"
echo three >> a.txt; git commit --quiet -m pathspec -- a.txt; report "git commit -m -- path"
echo four >> a.txt; git add a.txt; git commit --quiet -m again; report "git commit -m (again)"
git commit --quiet -m "empty" 2>/dev/null; report "git commit -m (nothing staged)"
# evidence refresh: a new session writes a different bundle
printf 'formal-ai session ses_second\nformal-ai model formal-ai/0.345.0\n' > "$stage/session-id.txt"
echo five >> a.txt; git add a.txt; git commit --quiet -m "second session" 2>&1 | head -2; report "second session"
git -C "$repo" show HEAD:dev/log/self-authored/issue-2229/evidence/session-id.txt
printf '\nworkspace: %s\n' "$work"
