#!/bin/bash
# Test that start-command v0.25.2 correctly supports:
# 1. $ --status <session-name> (finding sessions by --session name)
# 2. Detached mode correctly tracks screen session status

set -e

SESSION_NAME="test-session-$(date +%s)"
echo "=== Testing start-command v0.25.2 session name support ==="
echo "Session name: $SESSION_NAME"
echo ""

# Start a short-lived detached screen session
echo "1. Starting detached screen session with --session $SESSION_NAME..."
$ --isolated screen --detached --session "$SESSION_NAME" -- sleep 10 2>&1 || true

echo ""
echo "2. Querying status by session name: \$ --status $SESSION_NAME"
$ --status "$SESSION_NAME" 2>&1 || echo "(status query failed)"

echo ""
echo "3. Checking screen -ls for session..."
screen -ls 2>&1 | grep "$SESSION_NAME" || echo "(not found in screen -ls)"

echo ""
echo "4. Querying status with --output-format json..."
$ --status "$SESSION_NAME" --output-format json 2>&1 || echo "(json status query failed)"

echo ""
echo "5. Waiting 12s for session to finish..."
sleep 12

echo ""
echo "6. Querying status after session finishes..."
$ --status "$SESSION_NAME" --output-format json 2>&1 || echo "(status after finish failed)"

echo ""
echo "7. Checking screen -ls after finish..."
screen -ls 2>&1 | grep "$SESSION_NAME" || echo "(session no longer in screen -ls - expected)"

echo ""
echo "=== Test complete ==="
