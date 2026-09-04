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
# --ignore-scripts is deliberate (issue #2198). On npm >= 11.17 a bare
# `npm link` re-runs this package's own `prepare: husky` and then warns
#   npm warn allow-scripts 1 package has install scripts not yet covered by
#   allowScripts: @link-assistant/hive-mind@<version> (prepare: husky)
# which cannot be reviewed away: the review command — `npm approve-scripts
# --allow-scripts-pending` on 11.17, `npm install-scripts ls` since 11.19 —
# answers "No packages with unreviewed install scripts", and neither the
# allowScripts field in package.json nor --allow-scripts=<name> suppresses it,
# because `linkPkg()` in npm's lib/commands/link.js never resolves an
# allowScripts policy at all (its sibling `linkInstall()` does). Reported
# upstream as npm/cli#9951; --ignore-scripts is the only lever that works.
# npm 11.19 renamed the warning's prefix to `npm warn install-scripts` and
# changed nothing else, so the version numbers above are labels, not bounds.
# Nothing is lost: husky installs Git hooks, the install step of this job has
# already run it, and hooks have no bearing on whether the global bin commands
# below resolve and run.
npm link --ignore-scripts
echo "npm link completed successfully"

echo ""
echo "Testing 'hive' global command..."
timeout 10s hive --version
timeout 10s hive --help
echo "'hive' global command works"

echo ""
echo "Testing 'solve' global command..."
timeout 10s solve --version
timeout 10s solve --help
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
timeout 10s hive-telegram-bot --help
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
