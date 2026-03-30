#!/bin/bash
echo "========================================"
echo "Hive-Mind Container"
echo "========================================"

# Fix permissions and git config issues (runs as root)
echo "Fixing permissions and git configuration..."

# Remove .gitconfig if it's a directory and create proper git config
if [ -d /workspace/.gitconfig ]; then
  echo "  - Removing invalid .gitconfig directory"
  rm -rf /workspace/.gitconfig
fi

# Create proper git config file if it doesn't exist
if [ ! -f /workspace/.gitconfig ]; then
  echo "  - Creating git configuration"
  echo "[user]" > /workspace/.gitconfig
  echo "  name = Hive-Mind Bot" >> /workspace/.gitconfig
  echo "  email = hive@localhost" >> /workspace/.gitconfig
  echo "[init]" >> /workspace/.gitconfig
  echo "  defaultBranch = main" >> /workspace/.gitconfig
  echo "[safe]" >> /workspace/.gitconfig
  echo "  directory = *" >> /workspace/.gitconfig
  chown sandbox:sandbox /workspace/.gitconfig
fi

# Fix Claude and GitHub config directories
echo "  - Setting up Claude and GitHub directories"
mkdir -p /workspace/.claude/plugins /workspace/.config/gh
chown -R sandbox:sandbox /workspace/.claude /workspace/.config
chown -R sandbox:sandbox /app/claude-logs /app/claude-sessions /app/output 2>/dev/null || true

# Ensure /tmp has proper permissions for git operations
chmod 1777 /tmp

# Pass environment to sandbox user and run main logic
exec su -s /bin/bash sandbox -c '
cd /app

# Set token if provided
if [ -n "$GITHUB_TOKEN" ]; then
  export GH_TOKEN="$GITHUB_TOKEN"
elif [ -n "$GH_TOKEN" ]; then
  export GITHUB_TOKEN="$GH_TOKEN"
fi

# Set PATH for installed tools
export PATH="/workspace/.bun/bin:/workspace/.node-bin:/workspace/.cargo/bin:$PATH"

# Check if we have auth and URL
if gh auth status >/dev/null 2>&1 && [ -n "$GITHUB_URL" ]; then
  echo "✓ GitHub authenticated"

  # Build hive-mind command with all environment variables as CLI options
  HIVE_CMD="node hive.mjs \"$GITHUB_URL\""

  # Add options based on environment variables
  [ -n "$MONITOR_TAG" ] && HIVE_CMD="$HIVE_CMD --monitor-tag \"$MONITOR_TAG\""
  [ "$ALL_ISSUES" = "true" ] && HIVE_CMD="$HIVE_CMD --all-issues"
  [ "$SKIP_ISSUES_WITH_PRS" = "true" ] && HIVE_CMD="$HIVE_CMD --skip-issues-with-prs"
  [ -n "$CONCURRENCY" ] && HIVE_CMD="$HIVE_CMD --concurrency $CONCURRENCY"
  [ -n "$PULL_REQUESTS_PER_ISSUE" ] && HIVE_CMD="$HIVE_CMD --pull-requests-per-issue $PULL_REQUESTS_PER_ISSUE"
  [ -n "$MODEL" ] && HIVE_CMD="$HIVE_CMD --model $MODEL"
  [ -n "$INTERVAL" ] && HIVE_CMD="$HIVE_CMD --interval $INTERVAL"
  [ -n "$MAX_ISSUES" ] && HIVE_CMD="$HIVE_CMD --max-issues $MAX_ISSUES"
  [ "$DRY_RUN" = "true" ] && HIVE_CMD="$HIVE_CMD --dry-run"
  [ "$VERBOSE" = "true" ] && HIVE_CMD="$HIVE_CMD --verbose"
  [ "$ONCE" = "true" ] && HIVE_CMD="$HIVE_CMD --once"
  [ -n "$MIN_DISK_SPACE" ] && HIVE_CMD="$HIVE_CMD --min-disk-space $MIN_DISK_SPACE"
  [ "$AUTO_CLEANUP" = "true" ] && HIVE_CMD="$HIVE_CMD --auto-cleanup"
  [ "$FORK" = "true" ] && HIVE_CMD="$HIVE_CMD --fork"
  [ "$ATTACH_LOGS" = "true" ] && HIVE_CMD="$HIVE_CMD --attach-logs"
  [ -n "$PROJECT_NUMBER" ] && HIVE_CMD="$HIVE_CMD --project-number $PROJECT_NUMBER"
  [ -n "$PROJECT_OWNER" ] && HIVE_CMD="$HIVE_CMD --project-owner \"$PROJECT_OWNER\""
  [ -n "$PROJECT_STATUS" ] && HIVE_CMD="$HIVE_CMD --project-status \"$PROJECT_STATUS\""
  [ "$PROJECT_MODE" = "true" ] && HIVE_CMD="$HIVE_CMD --project-mode"

  # YouTrack integration options
  [ "$YOUTRACK_MODE" = "true" ] && HIVE_CMD="$HIVE_CMD --youtrack-mode"
  [ -n "$YOUTRACK_PROJECT_CODE" ] && HIVE_CMD="$HIVE_CMD --youtrack-project \"$YOUTRACK_PROJECT_CODE\""
  [ -n "$YOUTRACK_STAGE" ] && HIVE_CMD="$HIVE_CMD --youtrack-stage \"$YOUTRACK_STAGE\""

  # Target branch for PRs
  [ -n "$TARGET_BRANCH" ] && HIVE_CMD="$HIVE_CMD --target-branch \"$TARGET_BRANCH\""

  # Add any additional arguments from HIVE_ARGS
  [ -n "$HIVE_ARGS" ] && HIVE_CMD="$HIVE_CMD $HIVE_ARGS"

  # Try to start hive-mind, but catch failures
  echo "✓ Starting hive-mind to monitor: $GITHUB_URL"
  echo "  Command: $HIVE_CMD"
  eval $HIVE_CMD
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo "⚠ Hive-mind failed to start (exit code: $EXIT_CODE)"
    echo ""
    echo "Common issues:"
    echo "  - Claude CLI not authenticated: Run '\''claude'\'' or '\''code'\'' to authenticate"
    echo "  - Missing API key: Set CLAUDE_API_KEY environment variable"
    echo ""
    echo "Container running. Access terminal to configure."
    echo "Keeping container alive..."
    # Keep container running without consuming CPU
    tail -f /dev/null
  fi
else
  echo ""
  if ! gh auth status >/dev/null 2>&1; then
    echo "⚠ GitHub not authenticated. Run: gh auth login"
  fi
  if [ -z "$GITHUB_URL" ]; then
    echo "⚠ GITHUB_URL not set. Set it in Coolify environment variables"
  fi
  echo ""
  echo "Container running. Access terminal to configure."
  echo "Keeping container alive..."
  # Keep container running without consuming CPU
  tail -f /dev/null
fi
'
