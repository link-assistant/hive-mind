#!/usr/bin/env bash
# Issue #4063: reproduce "Repository has uncommitted changes after clone" offline.
#
# A file committed with CRLF line endings while .gitattributes marks it
# `text eol=crlf` (the state of mvnw.cmd in
# link-foundation/java-ai-driven-development-pipeline-template@dd803a2) is
# reported as modified by every fresh clone, although its bytes equal the commit.
#
# Usage: bash experiments/issue-4063-dirty-clone-repro.sh
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git init -q -b main "$work/origin"
cd "$work/origin"
git config user.email repro@example.invalid
git config user.name repro
# The blob is committed with CRLF *before* the attribute exists, so git stores it unnormalized.
printf '@echo off\r\necho hello\r\n' > mvnw.cmd
git add mvnw.cmd
printf '/mvnw.cmd text eol=crlf\n' > .gitattributes
git add .gitattributes
git commit -q -m 'add mvnw.cmd (CRLF blob) and .gitattributes'
echo "origin status (stat cache hides the defect): [$(git status --porcelain)]"
git clone -q "$work/origin" "$work/clone"
cd "$work/clone"
echo "clone status: [$(git status --porcelain)]"
echo "git ls-files --eol:"; git ls-files --eol mvnw.cmd
echo "index blob:        $(git ls-files -s mvnw.cmd | awk '{print $2}')"
echo "raw worktree hash: $(git hash-object --no-filters mvnw.cmd)   (equal => conversion artifact)"
echo "cleaned hash:      $(git hash-object mvnw.cmd)"
echo '/mvnw.cmd -text -eol -ident -filter -working-tree-encoding' >> "$(git rev-parse --git-path info/attributes)"
echo "clone status after .git/info/attributes override: [$(git status --porcelain)]"
