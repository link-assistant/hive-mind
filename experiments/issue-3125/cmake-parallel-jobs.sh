#!/usr/bin/env bash
# Issue #3125: what job count does `cmake --build --parallel` (no number) give
# the Makefiles generator, and which environment variables change it?
#
# The incident ran `cmake --build "$build" --target links_notation_tests --parallel`
# inside a 2.9 GiB container. This script prints the `make` command line that
# CMake runs for each variant. It compiles one trivial file, so it is cheap.
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat > "$work/CMakeLists.txt" <<'CM'
cmake_minimum_required(VERSION 3.16)
project(probe CXX)
add_executable(probe main.cpp)
CM
echo 'int main() { return 0; }' > "$work/main.cpp"
cmake -S "$work" -B "$work/build" -G "Unix Makefiles" > /dev/null

probe() {
  local label="$1"; shift
  local envs=()
  while [ "$1" != "--" ]; do envs+=("$1"); shift; done
  shift
  rm -rf "$work/build/CMakeFiles/probe.dir" 2>/dev/null || true
  local line
  line="$(env "${envs[@]}" cmake --build "$work/build" "$@" --verbose 2>&1 | grep -m1 -E 'make' || true)"
  printf '%-58s %s\n' "$label" "$line"
}
probe "--parallel (no number)" X=1 -- --parallel
probe "--parallel, CMAKE_BUILD_PARALLEL_LEVEL=2" CMAKE_BUILD_PARALLEL_LEVEL=2 -- --parallel
probe "no flag, CMAKE_BUILD_PARALLEL_LEVEL=2" CMAKE_BUILD_PARALLEL_LEVEL=2 --
probe "--parallel 2" X=1 -- --parallel 2
probe "-j4" X=1 -- -j4
