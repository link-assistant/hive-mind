#!/usr/bin/env bash
# Probe: can the bootstrap commit's author be forced to github-actions[bot]
# without writing any git config file inside the container?
#
# The draft workflow has to leave "no human commit on its branch" (issue #2233),
# and `solve` refuses to run at all unless git has a user.name/user.email
# (src/git.lib.mjs:244). Both facts are satisfied at once only if git reads the
# identity from the environment, so this measures that rather than assuming it.
set -euo pipefail

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
git init --quiet -b main .

export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=user.name
export GIT_CONFIG_VALUE_0='github-actions[bot]'
export GIT_CONFIG_KEY_1=user.email
export GIT_CONFIG_VALUE_1='41898282+github-actions[bot]@users.noreply.github.com'

echo "git config user.name  -> $(git config user.name)"
echo "git config user.email -> $(git config user.email)"

echo probe > file.txt
git add file.txt
git commit --quiet -m 'probe: bootstrap commit'
echo "commit author         -> $(git log -1 --format='%an <%ae>')"
echo "commit committer      -> $(git log -1 --format='%cn <%ce>')"
