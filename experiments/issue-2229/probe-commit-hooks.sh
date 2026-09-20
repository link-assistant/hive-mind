#!/bin/sh
# Issue #2229: can a `pre-commit` hook add files to the commit that is being made,
# and can a `prepare-commit-msg` hook add trailers, for every commit form an agent
# might use?  git's documentation warns that `git commit -a` and pathspec commits
# build a temporary index, so this measures rather than assumes.
#
# Usage: sh experiments/issue-2229/probe-commit-hooks.sh
set -u

work="$(mktemp -d)"
stage="$work/stage"
mkdir -p "$stage"
printf 'formal-ai session ses_probe\nformal-ai model formal-ai/0.345.0\n' > "$stage/session-id.txt"

repo="$work/repo"
mkdir -p "$repo"
git -C "$repo" init --quiet
git -C "$repo" config user.email probe@example.com
git -C "$repo" config user.name Probe
git -C "$repo" config commit.gpgsign false

hooks="$repo/.git/hooks"
cat > "$hooks/pre-commit" <<EOF
#!/bin/sh
set -e
dir="dev/log/self-authored/issue-2229/evidence"
mkdir -p "\$dir"
cp "$stage/session-id.txt" "\$dir/session-id.txt"
git add -f -- "\$dir"
EOF
chmod +x "$hooks/pre-commit"

cat > "$hooks/prepare-commit-msg" <<'EOF'
#!/bin/sh
set -e
git interpret-trailers --in-place \
  --trailer "Formal-AI-Session: ses_probe" \
  --trailer "Formal-AI-Evidence: dev/log/self-authored/issue-2229/evidence" \
  "$1"
EOF
chmod +x "$hooks/prepare-commit-msg"

report() {
  form="$1"
  sha="$(git -C "$repo" rev-parse HEAD)"
  if git -C "$repo" show "$sha:dev/log/self-authored/issue-2229/evidence/session-id.txt" >/dev/null 2>&1; then
    evidence=IN-TREE
  else
    evidence=MISSING
  fi
  trailers="$(git -C "$repo" log -1 --format=%B "$sha" | git interpret-trailers --parse | tr '\n' ';')"
  printf '%-28s evidence=%-8s trailers=%s\n' "$form" "$evidence" "${trailers:-<none>}"
  # start each case from a tree without the evidence so the next case has to add it again
  git -C "$repo" rm -r --quiet --cached dev/log/self-authored 2>/dev/null || true
  rm -rf "$repo/dev"
  git -C "$repo" commit --quiet --no-verify -m "drop evidence" >/dev/null 2>&1 || true
}

cd "$repo"
echo one > a.txt
git add a.txt
git commit --quiet -m "plain commit" ; report "git commit -m"

echo two >> a.txt
git commit --quiet -a -m "commit -a" ; report "git commit -a -m"

echo three >> a.txt
git commit --quiet -m "pathspec commit" -- a.txt ; report "git commit -m -- path"

echo four >> a.txt
git add a.txt
git commit --quiet --no-verify -m "no-verify commit" ; report "git commit --no-verify"

echo five >> a.txt
git add a.txt
git commit --quiet -m "two -m messages" -m "Manual-Trailer: yes" ; report "git commit -m -m"

echo six >> a.txt
git add a.txt
git commit --quiet -m "amended" >/dev/null
echo seven >> a.txt
git add a.txt
git commit --quiet --amend --no-edit ; report "git commit --amend"

printf '\nworkspace: %s\n' "$work"
