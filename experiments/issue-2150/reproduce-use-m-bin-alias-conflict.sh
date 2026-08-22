#!/usr/bin/env bash
# Reproduce use-m's npm alias collision without touching the real global prefix.
set -euo pipefail

test_prefix="$(mktemp -d)"
cleanup() {
  case "$test_prefix" in
    /tmp/*) rm -rf "$test_prefix" ;;
    *) echo "Refusing to remove unexpected path: $test_prefix" >&2 ;;
  esac
}
trap cleanup EXIT

echo "Isolated npm prefix: $test_prefix"
npm install -g --prefix "$test_prefix" zx-v-latest@npm:zx@8.8.5

set +e
npm install -g --prefix "$test_prefix" zx-v-8.8.5@npm:zx@8.8.5 > "$test_prefix/conflict.log" 2>&1
status=$?
set -e

cat "$test_prefix/conflict.log"
if [ "$status" -eq 0 ]; then
  echo "Expected the second alias to fail with EEXIST" >&2
  exit 1
fi
grep -q 'EEXIST' "$test_prefix/conflict.log"
grep -q '/bin/zx' "$test_prefix/conflict.log"
echo "Reproduced: second use-m alias cannot share the package binary (exit $status)."
