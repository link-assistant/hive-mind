#!/bin/bash
set -eu
for test_file in tests/claude-access-error-3759.test.mjs tests/claude-usage-limit-sources-3570.test.mjs tests/subscription-error-2161.test.mjs tests/inactive-subscription-2267.test.mjs tests/claude-result-error-precedence-2687.test.mjs tests/claude-process-exit-3015.test.mjs tests/claude-post-result-kill-3015.test.mjs tests/test-issue-1941-meaningless-error-fragment.test.mjs tests/format-tool-execution-failure-1845.test.mjs tests/test-issue-2141-error-text.mjs; do
  echo "Running $test_file"
  node "$test_file"
done
