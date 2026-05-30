#!/usr/bin/env bash
# Issue #1843 — Probe 2: confirm the exact Git Data API calls a custom-ref
# (no-branch, no-tag) image store will rely on.
#   - create blob -> tree -> parentless commit
#   - create custom ref refs/hive-mind-media/probe2
#   - GET single ref via git/ref/<ns>/<name>  (must return object.sha)
#   - re-create same ref (must 422 -> dedup fallback path)
#   - commit-SHA raw URL serves bytes
#   - cleanup
set -uo pipefail
OWNER=link-assistant
REPO=hive-mind
LOG="experiments/storage-probe2.log"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
exec > >(tee -a "$LOG") 2>&1
echo "=========== RUN $TS  repo=$OWNER/$REPO ==========="
api() { gh api "$@"; }
PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
P="media/probe2/onepx.png"
REF="hive-mind-media/probe2"

BLOB=$(api repos/$OWNER/$REPO/git/blobs -X POST --input - --jq .sha <<<"{\"content\":\"$PNG_B64\",\"encoding\":\"base64\"}")
echo "blob=$BLOB"
TREE=$(api repos/$OWNER/$REPO/git/trees -X POST --input - --jq .sha <<<"{\"tree\":[{\"path\":\"$P\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"$BLOB\"}]}")
echo "tree=$TREE"
COMMIT=$(api repos/$OWNER/$REPO/git/commits -X POST --input - --jq .sha <<<"{\"message\":\"probe2 (#1843)\",\"tree\":\"$TREE\",\"parents\":[]}")
echo "commit=$COMMIT"

echo "--- create ref ---"
api repos/$OWNER/$REPO/git/refs -X POST --input - <<<"{\"ref\":\"refs/$REF\",\"sha\":\"$COMMIT\"}" --jq '.ref + "  -> " + .object.sha' 2>&1 | head -2

echo "--- GET single ref (git/ref/$REF) ---"
api repos/$OWNER/$REPO/git/ref/$REF --jq '{ref, type: .object.type, sha: .object.sha}' 2>&1 | head -3

echo "--- re-create same ref (expect 422) ---"
api repos/$OWNER/$REPO/git/refs -X POST --input - <<<"{\"ref\":\"refs/$REF\",\"sha\":\"$COMMIT\"}" 2>&1 | head -2

echo "--- commit-SHA raw URL ---"
code=$(curl -sS -L -H "Authorization: token $(gh auth token)" -o /tmp/p2.out \
  -w '%{http_code} %{content_type} %{size_download}' \
  "https://github.com/$OWNER/$REPO/blob/$COMMIT/$P?raw=true")
echo "blob?raw=true -> $code"

echo "--- cleanup ---"
api repos/$OWNER/$REPO/git/refs/$REF -X DELETE 2>&1 | head -1; echo "deleted ($?)"
echo "exists after delete? $(api repos/$OWNER/$REPO/git/ref/$REF --jq .ref 2>&1 | head -1)"
echo "=== DONE ==="
