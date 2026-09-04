#!/usr/bin/env bash
#
# Issue #2186 — evidence that the snapshot leak is fixed in @link-assistant/agent 0.26.1.
#
# Downloads the published 0.26.0 and 0.26.1 tarballs from npm and shows, from the
# shipped sources rather than from a changelog, the two changes that bound the
# store in `$XDG_DATA_HOME/link-assistant-agent/snapshot/`:
#
#   1. `Snapshot.track()` writes `objects/info/alternates` pointing at the
#      repository's own object database, so the per-project store no longer
#      copies every object (0.26.0 has no `alternates` anywhere in `src/`).
#   2. `Project.prune()` exists and is called from `Project.fromDirectory()` and
#      `Instance.dispose()`, removing stores whose recorded `worktree` is gone
#      (0.26.0 has no `prune` at all).
#
# Usage: experiments/issue-2186/verify-agent-snapshot-fix.sh [workdir]
set -euo pipefail

workdir="${1:-$(mktemp -d)}"
mkdir -p "$workdir"
cd "$workdir"

for version in 0.26.0 0.26.1; do
  if [ ! -d "$version/package" ]; then
    mkdir -p "$version"
    url="$(npm view "@link-assistant/agent@$version" dist.tarball)"
    curl -fsSL "$url" -o "$version/agent.tgz"
    tar -xzf "$version/agent.tgz" -C "$version"
  fi
done

echo "== 1. objects/info/alternates =="
for version in 0.26.0 0.26.1; do
  hits="$(grep -rn "alternates" "$version/package/src" || true)"
  printf '%s: %s\n' "$version" "${hits:-<absent: the snapshot store is a full standalone object database>}"
done

echo
echo "== 2. Project.prune() =="
for version in 0.26.0 0.26.1; do
  hits="$(grep -rn "prune" "$version/package/src" || true)"
  printf '%s:\n%s\n' "$version" "${hits:-  <absent: nothing ever removes an orphaned store>}"
done

echo
echo "== 3. Snapshot.track() diff =="
diff -u "0.26.0/package/src/snapshot/index.ts" "0.26.1/package/src/snapshot/index.ts" || true

echo
echo "Working copy kept in: $workdir"
