#!/bin/sh
# Issue #2229, round 5. Round 4 measured that the hook must NOT touch the real
# index while git holds `.git/index.lock` (`git commit -a` and pathspec commits
# hold it for the whole run, so the extra `git add` fails and, with `set -e`,
# takes the commit down with it).  Two consequences to verify here:
#
#   - the hooks must be fail-open: a broken staging directory must not stop an
#     agent from committing its work;
#   - the real index is reconciled in `post-commit` instead, which runs after the
#     lock is released, so a pathspec commit leaves no phantom "deleted evidence"
#     in `git status` (issue #2135: untracked/dirty residue restarts the run).
#     Untracked residue from an aborted commit is hidden with .git/info/exclude,
#     which `git add -f` overrides.
set -u

work="$(mktemp -d)"; stage="$work/stage"; mkdir -p "$stage"
dir="dev/log/self-authored/issue-2229/evidence"
printf 'formal-ai session ses_probe\nformal-ai model formal-ai/0.345.0\n' > "$stage/session-id.txt"
repo="$work/repo"; mkdir -p "$repo"
git -C "$repo" init --quiet
git -C "$repo" config user.email probe@example.com
git -C "$repo" config user.name Probe
mkdir -p "$repo/.git/info"; printf '/dev/log/self-authored/\n' > "$repo/.git/info/exclude"

cat > "$repo/.git/hooks/pre-commit" <<EOF
#!/bin/sh
dir="$dir"
[ -e "\$(git rev-parse --git-path MERGE_HEAD)" ] && exit 0
[ -z "\$(git diff --cached --name-only -- . ':(exclude)'"\$dir" 2>/dev/null)" ] && exit 0
mkdir -p "\$dir" 2>/dev/null || exit 0
cp "$stage/session-id.txt" "\$dir/session-id.txt" 2>/dev/null || exit 0
git add -f -- "\$dir" >/dev/null 2>&1
exit 0
EOF
cat > "$repo/.git/hooks/prepare-commit-msg" <<EOF
#!/bin/sh
dir="$dir"
[ -e "\$(git rev-parse --git-path MERGE_HEAD)" ] && exit 0
case "\$(git cat-file blob ":\$dir/session-id.txt" 2>/dev/null || true)" in
  *ses_probe*) ;;
  *) exit 0 ;;
esac
git interpret-trailers --in-place --if-exists replace \\
  --trailer "Formal-AI-Session: ses_probe" \\
  --trailer "Formal-AI-Evidence: \$dir" "\$1" >/dev/null 2>&1
exit 0
EOF
cat > "$repo/.git/hooks/post-commit" <<EOF
#!/bin/sh
dir="$dir"
# only when HEAD already carries the evidence but the real index disagrees
git cat-file -e "HEAD:\$dir/session-id.txt" 2>/dev/null || exit 0
git diff --cached --quiet -- "\$dir" 2>/dev/null && exit 0
git add -f -- "\$dir" >/dev/null 2>&1
exit 0
EOF
chmod +x "$repo/.git/hooks/pre-commit" "$repo/.git/hooks/prepare-commit-msg" "$repo/.git/hooks/post-commit"

report() {
  sha="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" show "$sha:$dir/session-id.txt" >/dev/null 2>&1 && e=IN-TREE || e=MISSING
  t="$(git -C "$repo" log -1 --format=%B | git interpret-trailers --parse | grep -c '^Formal-AI-' || true)"
  printf '%-34s subject=%-14s evidence=%-8s trailers=%s status=[%s]\n' "$1" "$(git -C "$repo" log -1 --format=%s)" "$e" "$t" "$(git -C "$repo" status --porcelain | tr '\n' ' ')"
}

cd "$repo"
# the very first attributed commit is a pathspec commit: worst case for the index
echo one > a.txt
git commit --quiet -m "pathspec first" -- a.txt 2>/dev/null || { git add a.txt; git commit --quiet -m "pathspec first"; }
report "first commit is pathspec"
echo two >> a.txt; git commit --quiet -a -m "dash-a"; report "git commit -a -m"
echo three >> a.txt; git add a.txt; git commit --quiet -m "plain"; report "git commit -m"

# fail-open: staging directory disappears mid-run
rm -rf "$stage"
echo four >> a.txt; git add a.txt
git commit --quiet -m "staging gone" && echo "  commit still succeeded (fail-open)" || echo "  COMMIT BLOCKED - fail-open broken"
report "staging directory removed"
printf '\nworkspace: %s\n' "$work"
