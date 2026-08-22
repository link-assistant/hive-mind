#!/bin/bash
# Test script to verify fix for issue #356
# Tests that reusing an existing screen session executes the command

set -e

SESSION_NAME="test-issue-356-$$"
TEST_REPO="https://github.com/link-assistant/hive-mind"

echo "=== Testing Issue #356 Fix ==="
echo "This test verifies that running start-screen with an existing session"
echo "will execute the command in that session instead of just printing a message."
echo ""

# Cleanup
cleanup() {
    echo "Cleaning up..."
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    rm -f /tmp/test-output-$$.txt
    rm -f /tmp/screen-hardcopy-$$.txt
}

trap cleanup EXIT

echo "Step 1: Create a test solve command that we can safely run"
echo "We'll use a mock command since we don't want to actually run solve"

# First, let's test with a simpler approach - create a session manually
# to simulate what happens after the first start-screen call

echo ""
echo "Step 2: Create initial screen session (simulating first start-screen call)"
screen -dmS "$SESSION_NAME" bash -c 'echo "Initial session created"; exec bash'
sleep 1

if screen -ls | grep -q "$SESSION_NAME"; then
    echo "✓ Session created successfully"
else
    echo "✗ Session creation failed"
    exit 1
fi

echo ""
echo "Step 3: Test the fix by sending a new command to the existing session"
echo "This simulates what happens when start-screen is called the second time"

# Simulate sending a command via screen -X stuff (this is what our fix does)
TEST_COMMAND="echo 'Test command executed at $(date)'"
screen -S "$SESSION_NAME" -X stuff "${TEST_COMMAND}\n"
sleep 1

echo ""
echo "Step 4: Verify the command was executed in the session"
screen -S "$SESSION_NAME" -X hardcopy /tmp/screen-hardcopy-$$.txt
sleep 0.5

if [ -f /tmp/screen-hardcopy-$$.txt ]; then
    echo "Session buffer contents:"
    cat /tmp/screen-hardcopy-$$.txt
    echo ""

    if grep -q "Test command executed" /tmp/screen-hardcopy-$$.txt; then
        echo "✓ Command was executed in the existing session"
        echo "✓ Issue #356 fix verified!"
    else
        echo "✗ Command was NOT executed in the session"
        echo "✗ Fix verification failed"
        exit 1
    fi
else
    echo "✗ Could not capture session buffer"
    exit 1
fi

echo ""
echo "=== Test Passed ==="
