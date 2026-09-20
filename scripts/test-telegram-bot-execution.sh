#!/usr/bin/env bash
# test-telegram-bot-execution.sh
#
# Smoke-tests the telegram-bot.mjs CLI: it starts, it answers --help, and it
# accepts the multi-line override syntax from issue #487 in --dry-run mode.
#
# Usage:
#   bash scripts/test-telegram-bot-execution.sh
#
# Exit code 0 = the CLI runs; non-zero = a check failed.
#
# Extracted verbatim from the `test-execution` job of release.yml (issue #2221)
# so the workflow stays under the line limit scripts/check-file-line-limits.sh
# enforces, following the precedent of test-global-commands.sh next to it.

set -euo pipefail

echo "Testing telegram-bot.mjs basic execution..."
timeout 10s ./src/telegram-bot.mjs --help
echo "telegram-bot.mjs executes without critical errors"
echo ""
echo "Testing telegram-bot.mjs --dry-run with issue #487 command..."
timeout 10s ./src/telegram-bot.mjs \
  --token "test_token_123" \
  --allowed-chats "(-1002975819706 -1002861722681)" \
  --no-hive \
  --solve-overrides $'( \n  --auto-continue\n  --attach-logs\n  --verbose\n  --no-tool-check\n)' \
  --dry-run
echo "Issue #487 command passes with --dry-run"
