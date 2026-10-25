#!/bin/sh
set -eu
source_path='main.rs'
test -f "$source_path" && test ! -L "$source_path"
if ! command -v 'rustc' >/dev/null 2>&1; then
  printf '%s
' 'rustc: command not found' >&2
  printf '
%s
' '__formal_ai_owned_process_failed_0__' >&2
  exit 127
fi
verification_dir=$(mktemp -d "${TMPDIR:-/tmp}/formal-ai-verification.XXXXXXXXXX")
trap 'rm -rf -- "$verification_dir"' EXIT
printf '%s' '// rustc main.rs -o main
// ./main
// Emit the requested text followed by a newline.
fn main() {
    println!("{}", "Hello, World!");
}
' > "$verification_dir/declared-source"
cmp "$source_path" "$verification_dir/declared-source"
mkdir -p "$verification_dir/workspace/$(dirname "$source_path")"
cp -- "$source_path" "$verification_dir/workspace/$source_path"
cmp "$source_path" "$verification_dir/workspace/$source_path"
cd "$verification_dir/workspace"
printf '%s\n' 'Hello, World!' > "$verification_dir/expected"
if rustc main.rs -o main; then
  :
else
  process_status=$?
  printf '\n%s\n' '__formal_ai_owned_process_failed_0__' >&2
  exit "$process_status"
fi
if ./main > "$verification_dir/actual"; then
  :
else
  process_status=$?
  printf '\n%s\n' '__formal_ai_owned_process_failed_1__' >&2
  exit "$process_status"
fi
cmp "$verification_dir/expected" "$verification_dir/actual"
cat "$verification_dir/actual"
