#!/usr/bin/env bash
# Keep sequential local tests within the issue solver's shared memory budget.
set -euo pipefail
case "${1:-}" in
  *test-issue-2189-bounded-sanitize-worker.mjs)
    # A global V8 heap flag overrides this fixture's explicit 48 MiB worker cap.
    unset NODE_OPTIONS
    ;;
  *) export NODE_OPTIONS=--max-old-space-size=192 ;;
esac
exec prlimit --data=2147483648 --stack=16777216 --core=0 -- node "$@"
