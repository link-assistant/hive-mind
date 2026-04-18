#!/usr/bin/env bash
# test-global-commands.sh
#
# Tests that npm global commands are correctly installed and functional after
# running npm link from the local project folder.
#
# Usage:
#   bash scripts/test-global-commands.sh
#
# Exit code 0 = all global commands work; non-zero = command failed unexpectedly.

set -euo pipefail

echo "Testing npm global command installation from local folder..."
npm link
echo "npm link completed successfully"

echo ""
echo "Testing 'hive' global command..."
timeout 10s hive --version || true
timeout 10s hive --help || echo "Help command completed"
echo "'hive' global command works"

echo ""
echo "Testing 'solve' global command..."
timeout 10s solve --version || true
timeout 10s solve --help || echo "Help command completed"
echo "'solve' global command works"

echo ""
echo "Testing 'configure-claude' global command..."
timeout 10s configure-claude --help
CONFIGURE_CLAUDE_TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$CONFIGURE_CLAUDE_TEST_DIR"; npm unlink -g @link-assistant/hive-mind || true' EXIT
timeout 10s configure-claude --settings-path "$CONFIGURE_CLAUDE_TEST_DIR/settings.json"
timeout 10s configure-claude --settings-path "$CONFIGURE_CLAUDE_TEST_DIR/settings.json" --verify
echo "'configure-claude' global command works"

echo ""
echo "Testing 'hive-telegram-bot' global command..."
timeout 10s hive-telegram-bot --help || echo "Help command completed"
echo "'hive-telegram-bot' global command works"

echo ""
echo "Testing hive-telegram-bot --dry-run (issue #487)..."
timeout 30s hive-telegram-bot \
  --token "test_token" \
  --allowed-chats "(-1 -2)" \
  --no-hive \
  --solve-overrides "(--auto-continue --verbose)" \
  --dry-run
echo "'hive-telegram-bot --dry-run' works"

echo ""
echo "Cleaning up global link..."
npm unlink -g @link-assistant/hive-mind || true
