#!/bin/bash
# Test the exact scenario from issue #356
# Reproduce the problem where attaching to a screen doesn't help

set -e

SESSION_NAME="test-attach-356-$$"
MARKER_FILE="/tmp/test-attach-marker-$$.txt"

echo "=== Testing Exact Scenario from Issue #356 ==="
echo ""

cleanup() {
    echo "Cleaning up..."
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    rm -f "$MARKER_FILE"
}

trap cleanup EXIT

echo "Scenario: User runs start-screen twice in succession"
echo ""

echo "Step 1: First start-screen call creates session with a running command"
# Create session that immediately goes to a bash prompt (simulating after first solve finishes)
screen -dmS "$SESSION_NAME" bash
sleep 1

if screen -ls | grep -q "$SESSION_NAME"; then
    echo "✓ Session created: $SESSION_NAME"
else
    echo "✗ Failed to create session"
    exit 1
fi

echo ""
echo "Step 2: Second start-screen call sends command to existing session"
screen -S "$SESSION_NAME" -X stuff "echo 'Command from second start-screen' > $MARKER_FILE\n"
echo "✓ Command sent via 'screen -X stuff'"

echo ""
echo "Step 3: User tries to attach to see what's happening"
echo "   (In the real scenario, user runs: screen -R $SESSION_NAME)"
echo "   Testing if the command was executed..."
sleep 1

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Command WAS executed - session is working correctly"
    echo "  Content: $(cat $MARKER_FILE)"
else
    echo "✗ Command was NOT executed"
    echo "  This is the bug!"

    # Check screen buffer
    echo ""
    echo "  Let's check what's in the screen buffer:"
    screen -S "$SESSION_NAME" -X hardcopy /tmp/screen-hardcopy-$$.txt
    sleep 0.5
    if [ -f /tmp/screen-hardcopy-$$.txt ]; then
        echo "  Buffer contents:"
        cat /tmp/screen-hardcopy-$$.txt | head -20
    fi
fi

echo ""
echo "Step 4: Test what happens if we wait longer"
sleep 3
if [ -f "$MARKER_FILE" ]; then
    echo "✓ Command executed after waiting"
else
    echo "✗ Command still not executed after waiting"
fi

echo ""
echo "Step 5: Test if the issue is with the shell state"
# Send a simple command that should always work
rm -f "$MARKER_FILE"
screen -S "$SESSION_NAME" -X stuff "pwd > $MARKER_FILE\n"
sleep 1

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Simple command works, pwd output: $(cat $MARKER_FILE)"
else
    echo "✗ Even simple commands don't work"
fi
