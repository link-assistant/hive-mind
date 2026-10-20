#!/bin/sh
set -eu
verification_dir=$(mktemp -d)
trap 'rm -f "$verification_dir/expected" "$verification_dir/actual"; rmdir "$verification_dir"' EXIT HUP INT TERM
printf '%s\n' 'Hello, World!' > "$verification_dir/expected"
./main > "$verification_dir/actual"
cmp "$verification_dir/expected" "$verification_dir/actual"
cat "$verification_dir/actual"
