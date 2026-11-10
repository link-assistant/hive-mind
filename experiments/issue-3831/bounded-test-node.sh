#!/bin/sh
# Run the default suite inside the issue solver's small memory cgroup.
# A parent heap flag overrides worker_threads.resourceLimits. The containment
# fixture already bounds its input to 120 MiB and its worker heap to 48 MiB.
case "${1:-}" in
  *test-issue-2189-bounded-sanitize-worker.mjs)
    exec env -u NODE_OPTIONS node "$@"
    ;;
  *)
    exec env NODE_OPTIONS=--max-old-space-size=256 node "$@"
    ;;
esac
