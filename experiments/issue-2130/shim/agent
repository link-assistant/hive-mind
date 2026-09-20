#!/usr/bin/env bash
name="$(basename "$0")"
out="/tmp/gh-issue-solver-1785688606123/experiments/issue-2130/shim-capture-$name.txt"
{
  echo "=== INVOCATION at $(date -u +%T)"
  echo "ARGV:"; printf '  %q\n' "$@"
  echo "STDIN-BYTES: $(timeout 2 cat | wc -c)"
} >> "$out" 2>&1
exit 0
