#!/usr/bin/env bash
# Issue #1843 — Live experiment: which GitHub object stores serve a renderable
# image WITHOUT introducing a (visible) branch?
#
# We create one tiny PNG as a git blob -> tree -> parentless commit via the Git
# Data API, then point different ref types at that commit and test whether the
# bytes are served back over the raw/blob URLs that GitHub markdown can embed.
#
# Approaches tested:
#   A) tag ref          refs/tags/hive-mind-media-probe  -> blob/<tag>/<path>?raw=true
#   B) custom ref       refs/hive-mind-media/probe       -> blob/<commit-sha>/<path>?raw=true
#   C) commit SHA only  (no extra ref beyond B's, but URL by SHA)
#
# All probe refs are deleted at the end. Output is appended to the log so the
# result survives even if the session is interrupted.
set -uo pipefail

OWNER=link-assistant
REPO=hive-mind
LOG="experiments/storage-probe.log"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"

exec > >(tee -a "$LOG") 2>&1
echo "=================================================================="
echo "RUN $TS  repo=$OWNER/$REPO"
echo "=================================================================="

api() { gh api "$@"; }

# 1x1 transparent PNG (base64)
PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
PATH_IN_REPO="media/probe/onepx.png"

echo "--- repo visibility ---"
api repos/$OWNER/$REPO --jq '{visibility, private, default_branch}' || true

echo "--- 1) create blob ---"
BLOB_SHA=$(api repos/$OWNER/$REPO/git/blobs -X POST --input - --jq .sha <<JSON 2>&1
{"content":"$PNG_B64","encoding":"base64"}
JSON
)
echo "blob sha = $BLOB_SHA"

echo "--- 2) create tree ---"
TREE_SHA=$(api repos/$OWNER/$REPO/git/trees -X POST --input - --jq .sha <<JSON 2>&1
{"tree":[{"path":"$PATH_IN_REPO","mode":"100644","type":"blob","sha":"$BLOB_SHA"}]}
JSON
)
echo "tree sha = $TREE_SHA"

echo "--- 3) create parentless commit ---"
COMMIT_SHA=$(api repos/$OWNER/$REPO/git/commits -X POST --input - --jq .sha <<JSON 2>&1
{"message":"probe: storage experiment (issue #1843)","tree":"$TREE_SHA","parents":[]}
JSON
)
echo "commit sha = $COMMIT_SHA"

probe_url() {
  local label="$1" url="$2"
  echo ">>> $label"
  echo "    URL: $url"
  # Use gh's token so private repos are reachable too.
  local code ctype len
  read -r code ctype len < <(curl -sS -L \
    -H "Authorization: token $(gh auth token)" \
    -o /tmp/probe.out -w '%{http_code} %{content_type} %{size_download}' "$url" 2>/dev/null)
  echo "    HTTP $code  content-type=$ctype  bytes=$len"
  echo "    file: $(file -b /tmp/probe.out 2>/dev/null | head -c 80)"
}

echo "--- 4A) tag ref ---"
api repos/$OWNER/$REPO/git/refs -X POST --input - <<JSON 2>&1 | head -3
{"ref":"refs/tags/hive-mind-media-probe","sha":"$COMMIT_SHA"}
JSON
probe_url "tag blob?raw=true" "https://github.com/$OWNER/$REPO/blob/hive-mind-media-probe/$PATH_IN_REPO?raw=true"
probe_url "tag raw.githubusercontent" "https://raw.githubusercontent.com/$OWNER/$REPO/hive-mind-media-probe/$PATH_IN_REPO"

echo "--- 4B) custom ref (refs/hive-mind-media/probe) ---"
api repos/$OWNER/$REPO/git/refs -X POST --input - <<JSON 2>&1 | head -3
{"ref":"refs/hive-mind-media/probe","sha":"$COMMIT_SHA"}
JSON
probe_url "custom-ref via commit-SHA blob?raw=true" "https://github.com/$OWNER/$REPO/blob/$COMMIT_SHA/$PATH_IN_REPO?raw=true"
probe_url "custom-ref via commit-SHA raw.githubusercontent" "https://raw.githubusercontent.com/$OWNER/$REPO/$COMMIT_SHA/$PATH_IN_REPO"

echo "--- 5) cleanup: delete probe refs ---"
api repos/$OWNER/$REPO/git/refs/tags/hive-mind-media-probe -X DELETE 2>&1 | head -2; echo "tag delete done ($?)"
api repos/$OWNER/$REPO/git/refs/hive-mind-media/probe -X DELETE 2>&1 | head -2; echo "custom-ref delete done ($?)"

echo "--- 6) verify cleanup ---"
echo "tag still exists?    $(api repos/$OWNER/$REPO/git/ref/tags/hive-mind-media-probe --jq .ref 2>&1 | head -1)"
echo "custom still exists? $(api repos/$OWNER/$REPO/git/refs/hive-mind-media/probe --jq '.[].ref' 2>&1 | head -1)"
echo "=== DONE $TS ==="
