#!/usr/bin/env bash
# Issue #2187: run the Dockerfile's runtime block against the NEW box base
# (ghcr.io/link-foundation/box:2.7.0) without a full image build, to check that
# a base which already ships the pinned versions makes the block a no-op rather
# than a second installation next to the first.
#
# The block below is copied verbatim from Dockerfile's
# `ARG HIVE_MIND_NODE_VERSION` RUN step — keep it in sync if that step changes.
#
# Result on 2026-09-07 against ghcr.io/link-foundation/box:2.7.0: one node
# version before and after (v24.20.0), nvm default already pointing at
# it, "Removing superseded node" never printed, bun 1.4.2 unchanged.
set -euo pipefail

BASE="${1:-ghcr.io/link-foundation/box:2.7.0}"

docker run --rm -i --entrypoint bash "$BASE" -s <<'RUNTIME_BLOCK_EOF'
export HOME=/home/box
export NVM_DIR=/home/box/.nvm
export BUN_INSTALL=/home/box/.bun
HIVE_MIND_NODE_VERSION=24.20.0
HIVE_MIND_BUN_VERSION=1.4.2

echo "=== BEFORE ==="
ls -1 "$NVM_DIR"/versions/node
"$BUN_INSTALL/bin/bun" --version

echo "=== RUNTIME BLOCK ==="
set -e && 
    . "$NVM_DIR/nvm.sh" && 
    PREVIOUS_GLOBAL_LIB="$(dirname "$(dirname "$(command -v node)")")/lib/node_modules" && 
    GLOBAL_SPECS="" && 
    for package_json in "$PREVIOUS_GLOBAL_LIB"/*/package.json "$PREVIOUS_GLOBAL_LIB"/@*/*/package.json; do 
      [ -f "$package_json" ] || continue; 
      spec="$(node -p 'const pkg = require(process.argv[1]); pkg.name + "@" + pkg.version' "$package_json")"; 
      case "$spec" in npm@*|corepack@*) continue ;; esac; 
      GLOBAL_SPECS="$GLOBAL_SPECS $spec"; 
    done && 
    echo "Inherited global npm packages to re-install:${GLOBAL_SPECS:- (none)}" && 
    nvm install "${HIVE_MIND_NODE_VERSION}" && 
    nvm alias default "${HIVE_MIND_NODE_VERSION}" && 
    nvm use default && 
    if [ -n "$GLOBAL_SPECS" ]; then npm install -g $GLOBAL_SPECS --no-fund --force; fi && 
    for version_dir in "$NVM_DIR"/versions/node/*; do 
      [ -d "$version_dir" ] || continue; 
      if [ "$(basename "$version_dir")" = "v${HIVE_MIND_NODE_VERSION}" ]; then continue; fi; 
      echo "Removing superseded node $(basename "$version_dir")"; 
      rm -rf "$version_dir"; 
    done && 
    curl -fsSL https://bun.sh/install | bash -s "bun-v${HIVE_MIND_BUN_VERSION}" && 
    node --version && 
    npm --version && 
    "$BUN_INSTALL/bin/bun" --version

echo "=== AFTER ==="
echo "node versions in the nvm root:"
ls -1 "$NVM_DIR"/versions/node
echo "nvm default alias: $(cat "$NVM_DIR/alias/default")"
RUNTIME_BLOCK_EOF
