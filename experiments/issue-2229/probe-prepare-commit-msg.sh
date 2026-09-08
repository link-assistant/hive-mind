#!/bin/sh
# Issue #2229, round 2. `--no-verify` skips `pre-commit` but NOT
# `prepare-commit-msg` (measured in probe-commit-hooks.sh), which would leave a
# commit carrying trailers whose evidence is not in the tree - exactly the
# `Formal-AI-Session` without `Formal-AI-Evidence` shape that makes formal-ai's
# self-hosting metric fail hard.  So: can `prepare-commit-msg` do the staging
# itself, and is `--if-exists replace` idempotent under `--amend`?
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

cat > "$repo/.git/hooks/prepare-commit-msg" <<EOF
#!/bin/sh
set -e
case "\${2:-}" in
  merge|squash) exit 0 ;;
esac
dir="dev/log/self-authored/issue-2229/evidence"
mkdir -p "\$dir"
cp "$stage/session-id.txt" "\$dir/session-id.txt"
git add -f -- "\$dir"
git interpret-trailers --in-place --if-exists replace \\
  --trailer "Formal-AI-Session: ses_probe" \\
  --trailer "Formal-AI-Evidence: \$dir" \\
  "\$1"
EOF
chmod +x "$repo/.git/hooks/prepare-commit-msg"

report() {
  sha="$(git -C "$repo" rev-parse HEAD)"
  if git -C "$repo" show "$sha:dev/log/self-authored/issue-2229/evidence/session-id.txt" >/dev/null 2>&1; then evidence=IN-TREE; else evidence=MISSING; fi
  printf '%-30s evidence=%-8s trailers=%s\n' "$1" "$evidence" "$(git -C "$repo" log -1 --format=%B "$sha" | git interpret-trailers --parse | tr '\n' ';')"
  git -C "$repo" rm -r --quiet --cached dev/log/self-authored 2>/dev/null || true
  rm -rf "$repo/dev"
  git -C "$repo" commit --quiet --no-verify -m "drop evidence" >/dev/null 2>&1 || true
  git -C "$repo" status --porcelain
}

cd "$repo"
echo one > a.txt; git add a.txt
git commit --quiet -m "plain"; report "git commit -m"

echo two >> a.txt
git commit --quiet -a -m "commit -a"; report "git commit -a -m"

echo three >> a.txt
git commit --quiet -m "pathspec" -- a.txt; report "git commit -m -- path"

echo four >> a.txt; git add a.txt
git commit --quiet --no-verify -m "no-verify"; report "git commit --no-verify"

echo five >> a.txt; git add a.txt
git commit --quiet -m "before amend" >/dev/null
echo six >> a.txt; git add a.txt
git commit --quiet --amend --no-edit; report "git commit --amend (idempotent?)"

# merge commits must be left alone: attributing a merge of main to formal-ai
# would credit somebody else's commits to the model.
git checkout --quiet -b side
echo side > side.txt; git add side.txt; git commit --quiet -m "side"
git checkout --quiet -
echo main >> a.txt; git add a.txt; git commit --quiet -m "main"
git merge --quiet --no-ff side -m "merge side" >/dev/null 2>&1
sha="$(git rev-parse HEAD)"
printf '%-30s trailers=%s\n' "git merge" "$(git log -1 --format=%B "$sha" | git interpret-trailers --parse | tr '\n' ';' )"

printf '\nworkspace: %s\n' "$work"
