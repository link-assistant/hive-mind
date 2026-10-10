#!/usr/bin/env bash
# Run the default-suite test files from line $1 of the list in $2, 4 at a time,
# each with a 300 s timeout; failures are listed in ci-logs/remaining-failures.txt.
start="$1"; list="$2"
mkdir -p ci-logs/remaining
: > ci-logs/remaining-failures.txt
tail -n +"$start" "$list" | xargs -P 4 -I{} bash -c '
  f="{}"; log="ci-logs/remaining/$(echo "$f" | tr / _).log"
  timeout 300 node "$f" > "$log" 2>&1; code=$?
  [ $code -ne 0 ] && echo "$f exit $code" >> ci-logs/remaining-failures.txt
  true'
echo done >> ci-logs/remaining-failures.txt
