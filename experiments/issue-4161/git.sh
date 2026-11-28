#!/bin/sh
if [ "$1" = push ]; then
  printf 'WRITE git %s\n' "$*" >> "$SOLVE_FIXTURE_COMMANDS"
  exit 1
fi
PATH="$SOLVE_FIXTURE_REAL_PATH" exec git "$@"
