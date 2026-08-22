#!/bin/bash

echo "=== Adding reportError calls to all remaining catch blocks ==="
echo

# solve.execution.lib.mjs catch blocks
cat << 'EOF' > /tmp/execution_edits.txt
Line 60: setupTempDirectory - temp_directory_setup
Line 190: handleExecution - attach_error_log
Line 206: handleExecution - close_error_pr
Line 222: handleExecution - cleanup_temp_dir
EOF

# solve.feedback.lib.mjs catch blocks
cat << 'EOF' > /tmp/feedback_edits.txt
Line 69: detectAndCountFeedback - pr_status_check
Line 181: detectAndCountFeedback - pr_comments_fetch
Line 227: detectAndCountFeedback - issue_comments_fetch
Line 250: detectAndCountFeedback - commit_comments_fetch
Line 278: detectAndCountFeedback - pr_reviews_fetch
Line 299: detectAndCountFeedback - pr_review_comments_fetch
Line 338: detectAndCountFeedback - general_feedback_error
EOF

# solve.repository.lib.mjs catch blocks
cat << 'EOF' > /tmp/repository_edits.txt
Line 50: setupRepository - git_clone_error
Line 379: setupRepository - cleanup_error
EOF

# solve.results.lib.mjs catch blocks
cat << 'EOF' > /tmp/results_edits.txt
Line 71: cleanupClaudeFile - claude_file_cleanup
Line 315: handleSuccess - pr_search_error
Line 358: handleSuccess - attach_success_log
Line 374: handleSuccess - close_success_pr
EOF

# solve.validation.lib.mjs catch blocks
cat << 'EOF' > /tmp/validation_edits.txt
Line 143: validateEnvironmentAndInputs - validation_error
Line 147: validateEnvironmentAndInputs - log_dir_creation
EOF

# solve.watch.lib.mjs catch blocks
cat << 'EOF' > /tmp/watch_edits.txt
Line 35: checkPRMerged - pr_merge_check
Line 52: checkPRClosed - pr_close_check
Line 166: watchPR - claude_file_check
Line 192: watchPR - claude_file_recheck
Line 253: watchPR - watch_error
EOF

echo "Edit instructions prepared for manual application"