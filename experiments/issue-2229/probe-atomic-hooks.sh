#!/bin/sh
# Issue #2229, round 3: the design that has to hold.
#
#   pre-commit          stages the evidence bundle (round 1 measured that this is
#                       the only hook whose `git add` reaches the commit).
#   prepare-commit-msg  adds the trailers, but ONLY after checking the evidence is
#                       actually in the index it is about to be committed with -
#                       otherwise `git commit --no-verify`, which skips pre-commit
#                       but not prepare-commit-msg, would produce a commit whose
#                       `Formal-AI-Evidence` path does not resolve, and formal-ai's
#                       metric treats that as a hard error rather than a miss.
#
# Also checks that merges are left alone (`$2` is "message", not "merge", when
# `git merge -m` is used, so MERGE_HEAD is the reliable signal).
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
mkdir -p "\$dir"
cp "$stage/session-id.txt" "\$dir/session-id.txt"
git add -f -- "\$dir"
EOF
cat > "$repo/.git/hooks/prepare-commit-msg" <<'EOF'
#!/bin/sh
set -e
dir="dev/log/self-authored/issue-2229/evidence"
[ -e "$(git rev-parse --git-path MERGE_HEAD)" ] && exit 0
staged="$(git cat-file blob ":$dir/session-id.txt" 2>/dev/null || true)"
case "$staged" in
  *ses_probe*) ;;
  *) echo "hive-mind: evidence not staged, no trailers added" >&2; exit 0 ;;
esac
git interpret-trailers --in-place --if-exists replace \
  --trailer "Formal-AI-Session: ses_probe" \
  --trailer "Formal-AI-Evidence: $dir" \
  "$1"
EOF
chmod +x "$repo/.git/hooks/pre-commit" "$repo/.git/hooks/prepare-commit-msg"

report() {
  sha="$(git -C "$repo" rev-parse HEAD)"
  if git -C "$repo" show "$sha:dev/log/self-authored/issue-2229/evidence/session-id.txt" >/dev/null 2>&1; then evidence=IN-TREE; else evidence=MISSING; fi
  t="$(git -C "$repo" log -1 --format=%B "$sha" | git interpret-trailers --parse | grep -c '^Formal-AI-' || true)"
  printf '%-30s evidence=%-8s formal-ai-trailers=%s residue=[%s]\n' "$1" "$evidence" "$t" "$(git -C "$repo" status --porcelain | tr '\n' ' ')"
  git -C "$repo" rm -r --quiet --cached dev/log/self-authored 2>/dev/null || true
  rm -rf "$repo/dev"
  git -C "$repo" commit --quiet --no-verify -m "drop evidence" >/dev/null 2>&1 || true
}

cd "$repo"
echo one > a.txt; git add a.txt; git commit --quiet -m plain; report "git commit -m"
echo two >> a.txt; git commit --quiet -a -m dash-a; report "git commit -a -m"
echo three >> a.txt; git commit --quiet -m pathspec -- a.txt; report "git commit -m -- path"
echo four >> a.txt; git add a.txt; git commit --quiet --no-verify -m noverify; report "git commit --no-verify"
echo five >> a.txt; git add a.txt; git commit --quiet -m amendbase >/dev/null
echo six >> a.txt; git add a.txt; git commit --quiet --amend --no-edit; report "git commit --amend"

git checkout --quiet -b side; echo s > s.txt; git add s.txt; git commit --quiet -m side
git checkout --quiet -; echo m >> a.txt; git add a.txt; git commit --quiet -m mainline >/dev/null
git -C "$repo" rm -r --quiet --cached dev/log/self-authored 2>/dev/null || true; rm -rf "$repo/dev"; git commit --quiet --no-verify -m drop >/dev/null 2>&1 || true
git merge --quiet --no-ff side -m "merge side" >/dev/null 2>&1
report "git merge -m"
printf '\nworkspace: %s\n' "$work"
