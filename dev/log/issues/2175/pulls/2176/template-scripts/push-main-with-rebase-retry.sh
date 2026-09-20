#!/usr/bin/env bash
set -euo pipefail

remote="${1:-origin}"
branch="${2:-main}"

if git push "$remote" "HEAD:$branch"; then
  echo "Push succeeded."
  exit 0
fi

echo "::warning::Initial push failed; rebasing on ${remote}/${branch} before retry."
git pull --rebase "$remote" "$branch"
git push "$remote" "HEAD:$branch"
echo "Push succeeded after rebase retry."
