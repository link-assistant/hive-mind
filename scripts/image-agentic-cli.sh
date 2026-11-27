#!/usr/bin/env bash
# Keep explicitly selected native storage on the verified adapter while the
# stock CLI can be replaced independently by Bun.
set -eu
tool=${0##*/}
case "$tool" in
  codex)
    if [[ -v CODEX_AUTH_HOME || -v HIVE_MIND_CODEX_AUTH_IDENTITY || -v CODEX_SQLITE_HOME ||
          -v CODEX_ROLLOUT_HOME || -v CODEX_SESSION_INDEX_HOME ||
          -v CODEX_MESSAGE_HISTORY_HOME || -v CODEX_ROLLOUT_MAINTENANCE_HOME ]]; then
      exec /home/box/.hive-native/bin/codex "$@"
    fi
    ;;
  gemini)
    if [[ -v GEMINI_AUTH_HOME || -v HIVE_MIND_GEMINI_AUTH_IDENTITY ||
          -v GEMINI_HISTORY_HOME || -v HIVE_MIND_GEMINI_HISTORY_IDENTITY ]]; then
      exec /home/box/.hive-native/bin/gemini "$@"
    fi
    ;;
esac
exec "/home/box/.bun/bin/$tool" "$@"
