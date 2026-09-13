#!/usr/bin/env bash
# Issue #2247 (H9): prove that every language in src/task-image-languages.lib.mjs
# is one the task image can actually build and run, and that the languages
# removed from the pool are absent.
#
# The Scala task of 2026-09-13 failed with `/bin/sh: 1: scalac: not found`
# because nothing checked this. Usage:
#
#   experiments/verify-task-image-languages.sh [image]
#
# Defaults to the base image pinned in Dockerfile.
set -uo pipefail

IMAGE="${1:-ghcr.io/link-foundation/box:2.10.2}"
echo "Image: $IMAGE"
echo

probe() { # probe <label> <command>
  local label="$1" command="$2" output status
  output=$(docker run --rm --entrypoint bash "$IMAGE" -lc "$command" 2>&1)
  status=$?
  if [ $status -eq 0 ]; then
    printf '  %-12s ok    %s\n' "$label" "$(printf '%s' "$output" | head -n 1 | cut -c1-70)"
  else
    printf '  %-12s FAIL  %s\n' "$label" "$(printf '%s' "$output" | head -n 1 | cut -c1-70)"
  fi
  return $status
}

echo "Languages the pool offers (all must be ok):"
failed=0
while IFS='|' read -r name command; do
  probe "$name" "$command" || failed=$((failed + 1))
done <<'PROBES'
JavaScript|node --version
TypeScript|bun --version
Python|python3 --version
Go|go version
Rust|rustc --version
Ruby|ruby --version
Java|java -version
Kotlin|kotlinc -version
C|gcc --version
C++|g++ --version
C#|dotnet --version
F#|dotnet fsi --help
Swift|swift --version
PHP|php --version
Perl|perl --version
R|Rscript --version
OCaml|ocaml -version
Fortran|gfortran --version
PROBES

echo
echo "Languages removed from the pool (all must be missing):"
present=0
while IFS='|' read -r name command; do
  if probe "$name" "$command"; then present=$((present + 1)); fi
done <<'ABSENT'
Scala|command -v scalac
Haskell|command -v ghc
Elixir|command -v elixir
Clojure|command -v clojure
Erlang|command -v erl
Julia|command -v julia
Lua|command -v lua
Dart|command -v dart
Zig|command -v zig
Nim|command -v nim
Crystal|command -v crystal
Pascal|command -v fpc
COBOL|command -v cobc
Ada|command -v gnat
Prolog|command -v swipl
Racket|command -v racket
Elm|command -v elm
ABSENT

echo
echo "missing toolchains in the pool: $failed"
echo "unexpectedly present after removal: $present"
[ "$failed" -eq 0 ]
