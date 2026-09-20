#!/usr/bin/env bash
# Issue #2198 / F15 — does the pipeline template's change detector cover every
# commit in a PR, or only the last one?
#
# The template's scripts/detect-code-changes.mjs compares HEAD^2^..HEAD^2 on a
# pull_request event: the diff of the *final* PR head commit alone. This script
# builds the synthetic merge commit GitHub Actions checks out and runs the
# template's own detector against it.
#
# Usage: experiments/issue-2198/template-detect-changes-untested-commits.sh
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
detector=$repo_root/dev/log/issues/2198/pulls/2199/template-scripts/detect-code-changes.mjs
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cd "$work"
git init -q --initial-branch=main
git config user.email test@example.com
git config user.name 'Test User'
echo '{"name":"fixture","version":"0.0.0"}' > package.json
git add -A && git commit -qm base
base=$(git rev-parse HEAD)

# One push carrying two commits: source first, documentation second.
git checkout -qb feature
mkdir -p src && echo 'export const feature = true;' > src/feature.mjs
git add -A && git commit -qm 'code change'
mkdir -p docs && echo notes > docs/notes.md
git add -A && git commit -qm 'docs-only change'
head=$(git rev-parse HEAD)

# What actions/checkout materialises for a pull_request event.
git checkout -q main
git merge -q --no-ff -m 'Merge pull request' "$head"

echo "=== PR contents: $(git diff --name-only "$base" "$head" | tr '\n' ' ')"
echo "=== template detector, pull_request event"
GITHUB_EVENT_NAME=pull_request node "$detector" 2>&1 | grep -E 'Comparing|changed|any-code|js-changed|docs-changed|^  ' || true
