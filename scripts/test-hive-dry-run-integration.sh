#!/usr/bin/env bash
# test-hive-dry-run-integration.sh
#
# Smoke-tests that hive.mjs propagates --dry-run and --skip-claude-check to the
# solve command it spawns. A run that selects no issues is also a pass: the
# fixture repository is not guaranteed to have an open issue.
#
# Usage:
#   bash scripts/test-hive-dry-run-integration.sh
#
# Exit code 0 = hive completed; non-zero = hive itself failed.
#
# Extracted verbatim from the `test-execution` job of release.yml (issue #2221)
# so the workflow stays under the line limit scripts/check-file-line-limits.sh
# enforces. Deliberately without `pipefail`: GitHub's default shell is
# `bash -e {0}`, so in the workflow the pipeline's status was `tee`'s, and a
# hive exit code was never fatal here. Adding pipefail would be a new failure
# mode, not an extraction.
set -eu

echo "Testing hive dry-run mode with solve command integration..."
timeout 30s ./src/hive.mjs https://github.com/test/repo --dry-run --skip-claude-check --once --max-issues 1 2>&1 | tee hive_dry_run.log
if grep -q "solve.*--dry-run.*--skip-claude-check" hive_dry_run.log; then
  echo "hive correctly passes --dry-run and --skip-claude-check flags to solve command"
else
  echo "No issues were selected in dry-run mode; hive completed successfully"
fi
